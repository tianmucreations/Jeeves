import { session } from '../state/session.js';
import { getActiveProvider, refreshCredit } from '../providers/index.js';
import { getTools } from '../tools/index.js';
import { buildTurnMessages, getSystemPrompt, contextLimitFor, summaryDue, summariseHistory } from './context.js';
import { plainError, type ErrorKind } from './errors.js';
import { runCommand } from '../commands/registry.js';
import type { ImageAttachment } from '../platform/images.js';
import { imagePathsIn, loadImageFile, tooBig } from '../platform/images.js';
import { visionChoice, clearOldImages } from './vision.js';
import { cancelQuestion, askQuestion } from './question.js';
import { saveConversation } from '../platform/conversations.js';
import { isToolCapable } from '../models/filter.js';
import { autoCatalogue } from './auto.js';
import { isAuto, workingModelId, workerModel, expertModel, topModel, AUTO_NOTE, shouldTakeOver, createAskExpertTool, newAutoTurnState, topModelPriceRatio, topModelQuestion, REVIEW_FINISHED_JOBS } from './auto.js';
import { jobNeedsReview, reviewJob, fixRequest, startReproducing, stopReproducing, UNCHECKED_NOTICE } from './review.js';
import { requestApproval, hasPendingApproval, answerApproval } from './permissions.js';
import { withRateLimitRetry } from './retry.js';
import { recordModelFailure, recordModelSuccess } from './model-health.js';
import { killForegroundCommands } from '../tools/runBash.js';
import { resetDoomLoop } from './doom-loop.js';
import type { ModelMessage } from 'ai';
import type { Provider, StreamOptions, StreamResult } from '../providers/types.js';
import { clearOldToolResults } from './housekeeping.js';
import { startJob, endJob, reportStepCost, withinLimits } from './spending.js';
import { getAddress } from '../platform/config.js';
import { startTurnCheckpoints } from '../checkpoints/index.js';
import { noteSkipRequest } from './research-gate.js';
import { turns } from '../core/turn-machine.js';

// Added to the rulebook when the chosen model cannot use tools, so a task request
// gets a plain answer instead of a pretend attempt.
export const CHAT_ONLY_NOTE = `

Chat-Only Model

The model currently selected can only chat. For now you have no tools: you cannot read files, write files, list folders, or run commands, whatever the sections above say. If you are asked to do something that needs them, say plainly that the model in use can only chat, and suggest clicking Settings to choose one that can do tasks. Never pretend to have done it.`;

const DISCONNECTING: ReadonlySet<ErrorKind> = new Set(['auth', 'network', 'payment']);

// A weak model sometimes describes what it is about to do next and then stops
// without doing it, instead of calling a tool or saying plainly that it is
// finished - seen live on GLM-5.3-Flash (a screenshot titled "No Summary or
// Explanation", 22 Sept: the reply ended "Now let me read the true file in full
// so my edit keeps everything else exactly as it was" with nothing further, and
// the person had to ask whether it was still working). The rulebook now forbids
// this, but a weak model does not always follow that, so this catches the exact
// phrasing it forbids and nudges one real continuation, rather than leaving the
// person to notice and ask themselves.
// "Let me know" is an ordinary closing courtesy, not a dangling action - excluded
// so a genuinely finished reply is never flagged.
const UNFULFILLED_INTENTION = /^(now[, ]+)?(let me(?! know\b)\b|i(?:'|')?ll\b|i will\b|i(?:'|')?m going to\b|i am going to\b|next,? i(?:'|')?ll\b|next,? i will\b|first,? i(?:'|')?ll\b|first,? i will\b)/i;

export function endsMidIntention(text: string): boolean {
  const sentences = text.trim().split(/(?<=[.!?])\s+/).filter((sentence) => sentence.length > 0);
  const last = sentences[sentences.length - 1];
  return last !== undefined && UNFULFILLED_INTENTION.test(last.trim());
}

const CONTINUE_NUDGE =
  'You stopped after describing something you were about to do, without doing it and without saying the task is finished. Either do it now, with a tool call in this turn, or say plainly that the task is done.';

// ─────────────────────────────────────────────────────────────────────────────
// THE JOB CARRIES ON BY ITSELF (2 Oct). He ran a long job and got FOUR stops,
// each asking him to type "continue fixing the lanes until the checker passes"
// — a huge waste of his time. Claude Code runs a job until it is done; the
// brakes are the person's Esc, permission questions and the money limit, never
// a step count. So when the model stops early — an internal step budget ran
// out, or it trailed off describing what it was "about to do", or it literally
// told him to type a continuation — Jeeves now nudges it back to work
// IMMEDIATELY, in the same turn, and the person sees the work simply continue.
const STEP_CONTINUE_NUDGE =
  'Carry on with the task now, from where you left off. Do not report progress, do not ask whether to continue, and never tell the person to type anything - keep working with your tools until the task is finished, or until you need my permission for something.';

// The stop wording his screenshot caught, verbatim pattern: the reply's last
// sentence hands the job back with "type: continue ..." / "say the word".
const TYPE_TO_CONTINUE =
  /(?:to carry on[^.!?]*[.!?]?\s*|[^.!?]*\b(?:type|enter|press|say)\s+(?:the word|continue|carry on|go on|again)[^.!?]*[.!?]?\s*)$/i;

export function tellsPersonToContinue(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  return TYPE_TO_CONTINUE.test(trimmed.slice(-300));
}

// One mechanism for every early stop: budget reached, trailing off, or a
// "type: continue" instruction. Runs until the job genuinely ends, the person
// stops it, or an unreachable safety net trips (each continue is a full turn
// of steps; the doom-loop guard and the silence limiter catch real loops).
const MAX_STEP_CONTINUES = 40;

async function continueUntilDone(turn: Turn): Promise<void> {
  for (let continues = 0; continues < MAX_STEP_CONTINUES; continues++) {
    if (turn.stop.signal.aborted) return;
    const text = turn.result.text ?? '';
    if (!(turn.result.hitStepCap || endsMidIntention(text) || tellsPersonToContinue(text))) return;
    reportNewCosts(turn);
    turn.countedSteps = 0;
    const messages = [...turn.allMessages, { role: 'user' as const, content: STEP_CONTINUE_NUDGE }];
    const next = await askAgain(turn, messages);
    turn.allMessages = [...messages, ...next.messages];
    turn.result = {
      ...next,
      text: text && next.text ? `${text}\n\n${next.text}` : next.text || text,
      stepCosts: [...(turn.result.stepCosts ?? []), ...(next.stepCosts ?? [])],
      finishReason: next.finishReason,
    };
  }
}

// Claude Code's withheld max-output-tokens recovery: a reply cut off by the
// model's own size limit is resumed directly - no apology, no recap. Offered
// once: a failing recovery must never become its own doom loop.
const LENGTH_RESUME_REQUEST =
  'Your reply was cut off by the size limit. Resume exactly where you stopped, in mid-sentence if need be. No apology and no recap. If what remains is long, work in smaller pieces from here.';

// The job now running, so the person can stop it (Claude Code's Esc: the request is
// cancelled and running commands are closed).
let currentStop: AbortController | null = null;

// Stops the job now running: the model request, any command it started, any
// question waiting for an answer, and messages waiting their turn. Returns false
// when nothing was running.
export function stopTurn(): boolean {
  if (!currentStop || currentStop.signal.aborted) return false;
  currentStop.abort();
  killForegroundCommands();
  cancelQuestion();
  while (hasPendingApproval()) answerApproval(false);
  // Messages sent while busy are dropped too - "stop" means stop - but never silently: they
  // are listed, so nothing the person typed is lost without a word.
  const dropped: string[] = [];
  for (let next = session.takeQueued(); next !== undefined; next = session.takeQueued()) dropped.push(next);
  if (dropped.length > 0) {
    const list = dropped.map((text) => `"${text.length > 60 ? text.slice(0, 59) + '…' : text}"`).join(', ');
    session.addNotice(`I also set aside ${dropped.length === 1 ? 'the message' : 'the messages'} you had waiting: ${list}. Send ${dropped.length === 1 ? 'it' : 'them'} again if you still want ${dropped.length === 1 ? 'it' : 'them'} done.`);
  }
  return true;
}

// --- One message, answered: each step below has one job ---------------------------------------

// Everything one message needs while it is being answered, passed from step to step.
interface Turn {
  input: string;
  images: ImageAttachment[];
  modelId: string;
  auto: boolean;
  autoState: ReturnType<typeof newAutoTurnState>;
  stop: AbortController;
  // This job's number in the turn machine - every state note carries it, so a
  // stale job can never move the machine (see core/turn-machine.ts).
  generation: number;
  // Where this job's lines start in the conversation (for the double-check).
  turnStart: number;
  // How many of the steps' costs have been reported.
  countedSteps: number;
  assistantId: number | null;
  provider: Provider;
  messages: ModelMessage[];
  streamOptions: StreamOptions;
  allMessages: ModelMessage[];
  result: StreamResult;
  uncheckedNotice: boolean;
}

// A note about the person's message, the limits check, the backup: everything before Jeeves starts.
// False when nothing is to be sent (today's limit reached and not agreed).
async function beginTurn(input: string): Promise<boolean> {
  session.addUser(input);
  saveConversation();
  // "Skip the research" must come from the person, so it is read from their own words.
  const skipped = noteSkipRequest(input);
  if (skipped) session.addNotice(skipped);
  startTurnCheckpoints(input);
  startJob();
  // Nothing is sent once today's limit is reached, unless the person agrees.
  if (!(await withinLimits())) {
    endJob();
    session.addNotice('Stopped - nothing was sent.');
    return false;
  }
  return true;
}

// Quiet housekeeping: old tool output is cleared, and a long conversation summarised.
// The summary runs under the job's stop signal, so Esc ends it too (it used to be
// uninterruptible and kept spending after the person stopped the job).
async function tidyConversation(signal: AbortSignal): Promise<string> {
  if (signal.aborted) return workingModelId(session.model);
  const cleared = clearOldToolResults(session.history);
  if (cleared.freedTokens > 0) session.setHistory(cleared.messages);
  const modelId = workingModelId(session.model);
  if (summaryDue(session.estimateContextTokens(), contextLimitFor(modelId, session.models))) {
    await summariseHistory(signal);
  }
  return modelId;
}

// Pictures: those attached, plus any picture file whose address is in the words. A model that can't
// see them: the person is told plainly and picks what happens (their own choice of model is never
// changed behind their back). 'abandoned' when they chose to pick another model first.
async function resolvePictures(turn: Turn, attached: ImageAttachment[]): Promise<'go' | 'abandoned'> {
  let images = [...attached];
  for (const file of imagePathsIn(turn.input)) {
    const loaded = await loadImageFile(file);
    if (loaded.ok) images.push(loaded.image);
    else session.addNotice(loaded.reason);
  }
  images = images.filter((image) => !tooBig(image));
  if (images.length > 0) {
    const choice = visionChoice(turn.modelId, turn.auto);
    if (choice.send) {
      turn.modelId = choice.modelId;
      if (turn.auto) session.setActiveModel(turn.modelId);
    } else {
      const answer = await askQuestion({
        question: choice.note ?? "This AI model can't see pictures. Choose a model that does.",
        options: [{ label: 'Choose a model' }, { label: 'Send without the picture' }],
      });
      if (answer.startsWith('Choose')) {
        session.addNotice('Nothing was sent - click Settings, choose a model that can see pictures, then send it again.');
        session.openSettings();
        return 'abandoned';
      }
      images = [];
    }
  }
  turn.images = images;
  return 'go';
}

// Ends the turn's bookkeeping in one place: thinking off, the stop handle released, the job's
// spending closed, Auto's model display back to its worker.
function closeTurn(turn: Turn): void {
  session.setThinking(false);
  if (currentStop === turn.stop) currentStop = null;
  endJob();
  session.setActiveModel(turn.auto ? workerModel() : null);
}

// A retried stream starts its answer over, so any partly streamed text goes first - otherwise the
// retry would draw it twice.
function resetStreamOutput(turn: Turn): void {
  session.setThinking(false);
  if (turn.assistantId !== null) {
    session.setAssistantText(turn.assistantId, '');
    session.finishAssistant(turn.assistantId);
    turn.assistantId = null;
  }
  session.closeReasoningEntry();
}

// The request to the model: the rulebook, the tools, and what happens as the answer arrives.
function buildStreamOptions(turn: Turn, tools: StreamOptions['tools'], note: string): StreamOptions {
  const { auto, autoState, stop } = turn;
  return {
    modelId: turn.modelId,
    messages: turn.messages,
    tools,
    instructions: getSystemPrompt(turn.modelId) + note,
    abortSignal: stop.signal,
    beforeStep: async ({ stepFailures, stepCosts, messages: stepMessages }) => {
      // Each step of the job runs in the machine's "processing" state.
      turns.to('processing', turn.generation);
      for (const cost of stepCosts.slice(turn.countedSteps)) reportStepCost(cost);
      turn.countedSteps = stepCosts.length;
      if (!(await withinLimits())) {
        stop.abort();
        return {};
      }
      // In Auto mode the expert takes over the rest of a job the worker keeps failing.
      // If the expert keeps failing too, Jeeves asks before trying the strongest model.
      let stepModel: string | undefined;
      const expert = expertModel();
      const strongest = topModel();
      if (auto && expert && !autoState.expertTookOver && shouldTakeOver(stepFailures)) autoState.expertTookOver = true;
      // (The expert can also take over by saying so when consulted.)
      if (autoState.expertTookOver && autoState.takeoverStep < 0) autoState.takeoverStep = stepFailures.length;
      if (auto && strongest && autoState.expertTookOver && !autoState.askedAboutTop && shouldTakeOver(stepFailures.slice(autoState.takeoverStep))) {
        autoState.askedAboutTop = true;
        session.addNotice(topModelQuestion(getAddress() ?? 'Sir', topModelPriceRatio(autoCatalogue())));
        autoState.onTopModel = await requestApproval();
      }
      if (auto && autoState.expertTookOver && expert) {
        stepModel = autoState.onTopModel && strongest ? strongest : expert;
        session.setActiveModel(stepModel);
      }
      const tidied = clearOldToolResults(stepMessages);
      return { modelId: stepModel, messages: tidied.freedTokens > 0 ? tidied.messages : undefined };
    },
    onToken: (token) => {
      // The machine's fine state follows the real work: the model is writing.
      turns.to('streaming', turn.generation);
      session.setThinking(false);
      if (turn.assistantId === null) turn.assistantId = session.startAssistant();
      session.appendToken(turn.assistantId, token);
    },
    onReasoning: (delta) => {
      // The model is thinking privately before writing.
      turns.to('thinking', turn.generation);
      session.setThinking(true);
      if (session.verbose) session.appendReasoning(delta);
    },
    onToolCall: () => {
      // A tool is about to run - the job is in its working steps.
      turns.to('processing', turn.generation);
      session.setThinking(false);
      // Hide pre-tool chatter so only the final answer stays visible (spec 2.3). The
      // entry is removed, not just emptied, so the final answer appears below the
      // actions it reports on rather than above them.
      if (turn.assistantId !== null) {
        session.setAssistantText(turn.assistantId, '');
        session.finishAssistant(turn.assistantId);
        turn.assistantId = null;
      }
      session.closeReasoningEntry();
    },
  };
}

// The steps' costs not yet reported (each reply's cost is worked out per step).
function reportNewCosts(turn: Turn): void {
  for (const cost of (turn.result.stepCosts ?? []).slice(turn.countedSteps)) reportStepCost(cost);
}

// Asks the model again with more instructions, retrying politely if the service says slow down.
function askAgain(turn: Turn, messages: ModelMessage[], extra: Partial<StreamOptions> = {}): Promise<StreamResult> {
  return withRateLimitRetry(() => turn.provider.stream({ ...turn.streamOptions, ...extra, messages }), session.providerId, turn.stop.signal, () => resetStreamOutput(turn));
}

// The first request. Claude Code's single reactive compact: a conversation that outgrew the model
// mid-job is tidied hard, once, and the turn retried silently. A second failure is shown, so a
// doomed retry can never spiral.
async function firstReply(turn: Turn): Promise<void> {
  try {
    turn.result = await askAgain(turn, turn.messages);
  } catch (error) {
    if (turn.stop.signal.aborted || plainError(error, session.providerId).kind !== 'context') throw error;
    const cleared = clearOldToolResults(session.history);
    if (cleared.freedTokens > 0) session.setHistory(cleared.messages);
    await summariseHistory(turn.stop.signal);
    session.setStatus('working');
    turn.messages = buildTurnMessages(session.history, turn.input, turn.images);
    turn.result = await askAgain(turn, turn.messages);
  }
  turn.allMessages = [...turn.messages, ...turn.result.messages];
}

// A reply cut off by the model's own size limit resumes directly, once (Claude Code's
// withheld-error recovery - the person never sees the error).
async function resumeIfCutOff(turn: Turn): Promise<void> {
  if (turn.stop.signal.aborted || turn.result.finishReason !== 'length') return;
  reportNewCosts(turn);
  turn.countedSteps = 0;
  const resumeMessages = [...turn.allMessages, { role: 'user' as const, content: LENGTH_RESUME_REQUEST }];
  const resumed = await askAgain(turn, resumeMessages);
  turn.allMessages = [...resumeMessages, ...resumed.messages];
  turn.result = {
    ...resumed,
    text: (turn.result.text ?? '') + (resumed.text ?? ''),
    stepCosts: [...(turn.result.stepCosts ?? []), ...(resumed.stepCosts ?? [])],
    finishReason: resumed.finishReason,
  };
}

// Auto's double-check, once, when this job changed a program or wrote a document (where the cheap
// worker's mistakes were measured - see review.ts).
async function reviewIfNeeded(turn: Turn): Promise<void> {
  if (!(turn.auto && REVIEW_FINISHED_JOBS && jobNeedsReview(session.transcript.slice(turn.turnStart)) && !turn.stop.signal.aborted)) return;
  reportNewCosts(turn);
  turn.countedSteps = turn.result.stepCosts?.length ?? turn.countedSteps;
  const review = await reviewJob(turn.allMessages);
  if (review.kind === 'unavailable') {
    turn.uncheckedNotice = true;
  } else if (review.kind === 'problems') {
    turn.countedSteps = 0;
    if (turn.assistantId !== null) session.setAssistantText(turn.assistantId, '');
    const fixMessages = [...turn.allMessages, { role: 'user' as const, content: fixRequest(review.problems) }];
    // Changing files waits until the worker has reproduced a problem.
    startReproducing();
    try {
      turn.result = await askAgain(turn, fixMessages);
    } finally {
      stopReproducing();
    }
    turn.allMessages = [...fixMessages, ...turn.result.messages];
  }
}

// The answer is shown, remembered and paid for; the job is over.
function completeTurn(turn: Turn): void {
  if (turn.assistantId === null) turn.assistantId = session.startAssistant();
  session.setAssistantText(turn.assistantId, turn.result.text);
  session.finishAssistant(turn.assistantId);
  if (turn.uncheckedNotice) session.addNotice(UNCHECKED_NOTICE);
  recordModelSuccess(turn.modelId);
  session.setHistory(turn.allMessages);
  session.setLastReasoning(turn.result.reasoning);
  session.addUsage(turn.result.usage.input, turn.result.usage.output, turn.result.cost, turn.result.usage.cached ?? 0);
  session.setRateLimit(turn.result.rateLimit);
  void refreshCredit();
  reportNewCosts(turn);
  session.setPlanResetAt(null);
  closeTurn(turn);
  // The return to idle happens once, in runTurn's exit door (release) - a job
  // can no longer stamp "idle" while it is still tearing down.
  saveConversation();
}

// The job did not finish: stopped by the person, or something went wrong (said in plain English).
function failTurn(turn: Turn, error: unknown): void {
  closeTurn(turn);
  if (turn.stop.signal.aborted) {
    if (turn.assistantId !== null) session.finishAssistant(turn.assistantId);
    session.addNotice('Stopped, as you asked - nothing more will be spent on this.');
    saveConversation();
    return;
  }
  const plain = plainError(error, session.providerId);
  // A bad key or empty credit is an account problem, not this model's fault, and a too-long
  // conversation is the person's, not the model's - only count failures that actually point at the
  // model itself being unreliable right now.
  if (plain.kind === 'rate-limit' || plain.kind === 'model' || plain.kind === 'network' || plain.kind === 'other') {
    recordModelFailure(turn.modelId);
  }
  if (turn.assistantId !== null) session.finishAssistant(turn.assistantId);
  session.addError(plain.message);
  if (plain.resetAt !== undefined) session.setPlanResetAt(plain.resetAt);
  // The technical text stays off screen unless Show every step is on.
  if (session.verbose && plain.detail) session.addNotice(`Technical details: ${plain.detail}`);
  // A broken account or connection stays flagged on screen ("disconnected") until
  // the person tries again; every other failure lands back on idle through the
  // exit door in runTurn.
  if (DISCONNECTING.has(plain.kind)) session.setStatus('disconnected');
  saveConversation();
}

// One message from the person: a typed command, or a job for the model.
//
// THE BACKGROUND CONTRACT (owner's order: "deterministic state machine ... roll
// back to the last safe state"):
//   1. THE GATE — the turn machine reserves the single job slot atomically. A
//      message arriving in any window where a job already lives is QUEUED, never
//      run side by side (the old code had a race window that could start a second
//      job inside the first and clobber its stop handle and spending meter).
//   2. THE EXIT DOOR — release() runs in a finally, so however the job ends
//      (finished, declined at the spending question, stopped, failed, crashed)
//      the machine ends it exactly once and the window returns to idle. The old
//      code returned early on a declined spending question and left the window
//      stuck on "working" forever — his "text box missing" screenshot.
export async function runTurn(input: string, attached: ImageAttachment[] = []): Promise<void> {
  if (await runCommand(input)) return;
  const generation = turns.reserve();
  if (generation === null) {
    // Another job holds the slot: the message waits its turn, exactly as if the
    // window had queued it (Claude Code's queue-while-busy).
    session.queueMessage(input, attached);
    return;
  }
  // The stop handle is armed the moment the slot is ours, so Esc works from the
  // very first instant - including against a spending question (before, the
  // window ignored Esc until the model request had actually started).
  const stop = new AbortController();
  currentStop = stop;
  try {
    if (!(await beginTurn(input))) return;
   
    const modelId = await tidyConversation(stop.signal);
    const auto = isAuto(session.model);
    session.setActiveModel(auto ? workerModel() : null);
    session.beginTurn();
    resetDoomLoop();
    session.setStatus('working');
    const turn = {
      input,
      images: [],
      modelId,
      auto,
      autoState: newAutoTurnState(),
      stop,
      generation,
      turnStart: session.transcript.length,
      countedSteps: 0,
      assistantId: null,
      uncheckedNotice: false,
    } as unknown as Turn;
    try {
      turn.provider = getActiveProvider();
      // A note from Undo travels with the next message, so the model knows files changed back.
      const note_ = session.pendingContextNote;
      session.pendingContextNote = null;
      if ((await resolvePictures(turn, attached)) === 'abandoned') {
        closeTurn(turn);
        saveConversation();
        return;
      }
      session.setHistory(clearOldImages(session.history));
      turn.messages = buildTurnMessages(session.history, note_ ? `${note_}\n\n${input}` : input, turn.images);
      // Models without tool support get a tool-free chat mode automatically (spec 4.2).
      const currentModel = session.models.find((model) => model.id === turn.modelId);
      const toolCapable = !currentModel || isToolCapable(currentModel);
      const tools = toolCapable ? { ...getTools(), ...(auto ? { askExpert: createAskExpertTool(turn.autoState) } : {}) } : {};
      const note = !toolCapable ? CHAT_ONLY_NOTE : auto ? AUTO_NOTE.replaceAll('{{ADDRESS}}', getAddress() ?? 'Sir') : '';
      turn.streamOptions = buildStreamOptions(turn, tools, note);
      await firstReply(turn);
      await resumeIfCutOff(turn);
      await continueUntilDone(turn);
      await reviewIfNeeded(turn);
      completeTurn(turn);
    } catch (error) {
      failTurn(turn, error);
    }
  } finally {
    // THE EXIT DOOR: exactly one ending per job, whatever happened above.
    if (currentStop === stop) currentStop = null;
   
    turns.release(generation);
  }
}
