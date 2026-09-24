import { session } from '../state/session.js';
import { getActiveProvider, refreshCredit } from '../providers/index.js';
import { getTools } from '../tools/index.js';
import { buildTurnMessages, getSystemPrompt, contextLimitFor, summaryDue, summariseHistory } from './context.js';
import { plainError, type ErrorKind } from './errors.js';
import { toggleVerbose } from '../commands/verbose.js';
import { openModelPicker } from '../commands/model.js';
import { clearConversation } from '../commands/clear.js';
import { openAddressPrompt } from '../commands/address.js';
import { isToolCapable } from '../models/filter.js';
import { autoCatalogue } from './auto.js';
import { isAuto, workingModelId, workerModel, expertModel, topModel, AUTO_NOTE, shouldTakeOver, createAskExpertTool, newAutoTurnState, topModelPriceRatio, topModelQuestion, REVIEW_FINISHED_JOBS } from './auto.js';
import { jobNeedsReview, reviewJob, fixRequest, startReproducing, stopReproducing, UNCHECKED_NOTICE } from './review.js';
import { requestApproval, hasPendingApproval, answerApproval } from './permissions.js';
import { withRateLimitRetry } from './retry.js';
import { recordModelFailure, recordModelSuccess } from './model-health.js';
import { killAllRunningCommands } from '../tools/runBash.js';
import type { StreamOptions } from '../providers/types.js';
import { clearOldToolResults } from './housekeeping.js';
import { startJob, endJob, reportStepCost, withinLimits } from './spending.js';
import { getAddress } from '../platform/config.js';
import { startTurnCheckpoints, undoLastChange } from '../checkpoints/index.js';
import { noteSkipRequest } from './research-gate.js';
import { untrustProject, untrustCommandFamilies } from './trust.js';

// Added to the rulebook when the chosen model cannot use tools, so a task request
// gets a plain answer instead of a pretend attempt.
export const CHAT_ONLY_NOTE = `

Chat-Only Model

The model currently selected can only chat. For now you have no tools: you cannot read files, write files, list folders, or run commands, whatever the sections above say. If you are asked to do something that needs them, say plainly that the model in use can only chat, and suggest typing /model to choose one that can do tasks. Never pretend to have done it.`;

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

// The job now running, so the person can stop it (Claude Code's Esc: the request is
// cancelled and running commands are closed).
let currentStop: AbortController | null = null;

// Stops the job now running: the model request, any command it started, any
// question waiting for an answer, and messages waiting their turn. Returns false
// when nothing was running.
export function stopTurn(): boolean {
  if (!currentStop || currentStop.signal.aborted) return false;
  currentStop.abort();
  killAllRunningCommands();
  while (hasPendingApproval()) answerApproval(false);
  while (session.takeQueued() !== undefined) {
    // Messages sent while busy are dropped too - "stop" means stop.
  }
  return true;
}

export async function runTurn(input: string): Promise<void> {
  if (input.startsWith('/') && input.length > 1 && !input.startsWith('/ ')) {
    if (input === '/settings') {
      session.openSettings();
    } else if (input === '/help') {
      session.openHelp();
    } else if (input === '/model') {
      openModelPicker();
    } else if (input === '/keys') {
      session.openKeys();
    } else if (input === '/folder') {
      session.openFolderPicker();
    } else if (input === '/verbose') {
      session.addNotice(toggleVerbose());
    } else if (input === '/address') {
      openAddressPrompt();
    } else if (input === '/ask') {
      untrustCommandFamilies();
      session.addNotice(
        untrustProject()
          ? "I'll ask before every change in this project folder again."
          : 'I already ask before every change in this project folder.'
      );
    } else if (input === '/undo') {
      if (session.status === 'working') {
        session.addNotice('Undo works between tasks - wait for this one to finish, then type /undo.');
      } else {
        try {
          const outcome = await undoLastChange();
          session.addNotice(outcome.message);
          if (outcome.historyNote) session.pendingContextNote = outcome.historyNote;
        } catch (error) {
          session.addError("Undo didn't work this time - nothing was changed. Please try /undo again.");
          if (session.verbose) session.addNotice(`Technical details: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } else if (input === '/clear') {
      clearConversation();
      session.addNotice('Started a fresh conversation - the earlier one is cleared.');
    } else if (input === '/exit') {
      session.requestExit();
    } else {
      session.addNotice("I don't know that command - type /help to see them all.");
    }
    return;
  }

  session.addUser(input);
  // "Skip the research" must come from the person, so it is read from their own words.
  const skipped = noteSkipRequest(input);
  if (skipped) session.addNotice(skipped);
  startTurnCheckpoints(input);
  startJob();
  // Nothing is sent once today's limit is reached, unless the person agrees.
  if (!(await withinLimits())) {
    endJob();
    session.addNotice('Stopped - nothing was sent.');
    return;
  }
  // Quiet housekeeping: old tool output is cleared, and a long conversation summarised.
  const cleared = clearOldToolResults(session.history);
  if (cleared.freedTokens > 0) session.setHistory(cleared.messages);
  const modelId = workingModelId(session.model);
  if (summaryDue(session.estimateContextTokens(), contextLimitFor(modelId, session.models))) {
    await summariseHistory();
  }
  const auto = isAuto(session.model);
  const autoState = newAutoTurnState();
  session.setActiveModel(auto ? workerModel() : null);
  const stop = new AbortController();
  currentStop = stop;
  let countedSteps = 0;
  session.beginTurn();
  session.setStatus('working');
  const turnStart = session.transcript.length;
  let assistantId: number | null = null;
  try {
    const provider = getActiveProvider();
    // A note from /undo travels with the next message, so the model knows files changed back.
    const note_ = session.pendingContextNote;
    session.pendingContextNote = null;
    const messages = buildTurnMessages(session.history, note_ ? `${note_}\n\n${input}` : input);
    // Models without tool support get a tool-free chat mode automatically (spec 4.2).
    const currentModel = session.models.find((model) => model.id === modelId);
    const toolCapable = !currentModel || isToolCapable(currentModel);
    const tools = toolCapable ? { ...getTools(), ...(auto ? { askExpert: createAskExpertTool(autoState) } : {}) } : {};
    const note = !toolCapable ? CHAT_ONLY_NOTE : auto ? AUTO_NOTE.replaceAll('{{ADDRESS}}', getAddress() ?? 'Sir') : '';
    const streamOptions: StreamOptions = {
      modelId,
      messages,
      tools,
      instructions: getSystemPrompt(modelId) + note,
      abortSignal: stop.signal,
      beforeStep: async ({ stepFailures, stepCosts, messages: stepMessages }) => {
        for (const cost of stepCosts.slice(countedSteps)) reportStepCost(cost);
        countedSteps = stepCosts.length;
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
        session.setThinking(false);
        if (assistantId === null) assistantId = session.startAssistant();
        session.appendToken(assistantId, token);
      },
      onReasoning: (delta) => {
        session.setThinking(true);
        if (session.verbose) session.appendReasoning(delta);
      },
      onToolCall: () => {
        session.setThinking(false);
        // Hide pre-tool chatter so only the final answer stays visible (spec 2.3). The
        // entry is removed, not just emptied, so the final answer appears below the
        // actions it reports on rather than above them.
        if (assistantId !== null) {
          session.setAssistantText(assistantId, '');
          session.finishAssistant(assistantId);
          assistantId = null;
        }
        session.closeReasoningEntry();
      },
    };
    let uncheckedNotice = false;
    let result = await withRateLimitRetry(() => provider.stream(streamOptions), session.providerId, stop.signal);
    let allMessages = [...messages, ...result.messages];
    // Auto's double-check, once, when this job changed a program or wrote a document
    // (where the cheap worker's mistakes were measured - see review.ts).
    if (auto && REVIEW_FINISHED_JOBS && jobNeedsReview(session.transcript.slice(turnStart)) && !stop.signal.aborted) {
      for (const cost of (result.stepCosts ?? []).slice(countedSteps)) reportStepCost(cost);
      countedSteps = result.stepCosts?.length ?? countedSteps;
      const review = await reviewJob(allMessages);
      if (review.kind === 'unavailable') {
        uncheckedNotice = true;
      } else if (review.kind === 'problems') {
        countedSteps = 0;
        if (assistantId !== null) session.setAssistantText(assistantId, '');
        const fixMessages = [...allMessages, { role: 'user' as const, content: fixRequest(review.problems) }];
        // Changing files waits until the worker has reproduced a problem.
        startReproducing();
        try {
          result = await withRateLimitRetry(() => provider.stream({ ...streamOptions, messages: fixMessages }), session.providerId, stop.signal);
        } finally {
          stopReproducing();
        }
        allMessages = [...fixMessages, ...result.messages];
      }
    }
    // Caught once, regardless of Auto: a reply that trails off describing an
    // intention it never carried out gets one real chance to finish, instead of
    // being shown to the person as if the job had simply stopped.
    if (!stop.signal.aborted && endsMidIntention(result.text)) {
      for (const cost of (result.stepCosts ?? []).slice(countedSteps)) reportStepCost(cost);
      countedSteps = 0;
      const continueMessages = [...allMessages, { role: 'user' as const, content: CONTINUE_NUDGE }];
      const continued = await withRateLimitRetry(() => provider.stream({ ...streamOptions, messages: continueMessages }), session.providerId, stop.signal);
      allMessages = [...continueMessages, ...continued.messages];
      result = { ...continued, text: result.text && continued.text ? `${result.text}\n\n${continued.text}` : result.text || continued.text };
    }
    if (assistantId === null) assistantId = session.startAssistant();
    session.setAssistantText(assistantId, result.text);
    session.finishAssistant(assistantId);
    if (uncheckedNotice) session.addNotice(UNCHECKED_NOTICE);
    recordModelSuccess(modelId);
    session.setHistory(allMessages);
    session.setLastReasoning(result.reasoning);
    session.addUsage(result.usage.input, result.usage.output, result.cost, result.usage.cached ?? 0);
    session.setRateLimit(result.rateLimit);
    void refreshCredit();
    for (const cost of (result.stepCosts ?? []).slice(countedSteps)) reportStepCost(cost);
    session.setPlanResetAt(null);
    session.setActiveModel(auto ? workerModel() : null);
    session.setThinking(false);
    if (currentStop === stop) currentStop = null;
    endJob();
    session.setStatus('idle');
  } catch (error) {
    session.setThinking(false);
    if (currentStop === stop) currentStop = null;
    endJob();
    session.setActiveModel(auto ? workerModel() : null);
    if (stop.signal.aborted) {
      if (assistantId !== null) session.finishAssistant(assistantId);
      session.addNotice('Stopped, as you asked - nothing more will be spent on this.');
      session.setStatus('idle');
      return;
    }
    const plain = plainError(error, session.providerId);
    // A bad key or empty credit is an account problem, not this model's fault, and a
    // too-long conversation is the person's, not the model's - only count failures
    // that actually point at the model itself being unreliable right now.
    if (plain.kind === 'rate-limit' || plain.kind === 'model' || plain.kind === 'network' || plain.kind === 'other') {
      recordModelFailure(modelId);
    }
    if (assistantId !== null) session.finishAssistant(assistantId);
    session.addError(plain.message);
    if (plain.resetAt !== undefined) session.setPlanResetAt(plain.resetAt);
    // The technical text stays off screen unless /verbose is on.
    if (session.verbose && plain.detail) session.addNotice(`Technical details: ${plain.detail}`);
    session.setStatus(DISCONNECTING.has(plain.kind) ? 'disconnected' : 'idle');
  }
}