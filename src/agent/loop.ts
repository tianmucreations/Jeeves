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
import { isAuto, workingModelId, AUTO_WORKER_MODEL, AUTO_EXPERT_MODEL, AUTO_NOTE, shouldTakeOver, createAskExpertTool, type AutoTurnState } from './auto.js';
import { clearOldToolResults } from './housekeeping.js';
import { startJob, endJob, reportSpend, withinLimits } from './spending.js';
import { getAddress } from '../platform/config.js';

// Added to the rulebook when the chosen model cannot use tools, so a task request
// gets a plain answer instead of a pretend attempt.
export const CHAT_ONLY_NOTE = `

Chat-Only Model

The model currently selected can only chat. For now you have no tools: you cannot read files, write files, list folders, or run commands, whatever the sections above say. If you are asked to do something that needs them, say plainly that the model in use can only chat, and suggest typing /model to choose one that can do tasks. Never pretend to have done it.`;

const DISCONNECTING: ReadonlySet<ErrorKind> = new Set(['auth', 'network', 'payment']);

export async function runTurn(input: string): Promise<void> {
  if (input.startsWith('/') && input.length > 1 && !input.startsWith('/ ')) {
    if (input === '/help') {
      session.openHelp();
    } else if (input === '/model') {
      openModelPicker();
    } else if (input === '/keys') {
      session.openKeys();
    } else if (input === '/verbose') {
      session.addNotice(toggleVerbose());
    } else if (input === '/address') {
      openAddressPrompt();
    } else if (input === '/clear') {
      clearConversation();
    } else if (input === '/exit') {
      session.requestExit();
    } else {
      session.addNotice("I don't know that command - type /help to see them all.");
    }
    return;
  }

  session.addUser(input);
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
  const autoState: AutoTurnState = { expertTookOver: false };
  session.setActiveModel(auto ? AUTO_WORKER_MODEL : null);
  const stop = new AbortController();
  let countedSteps = 0;
  session.beginTurn();
  session.setStatus('working');
  let assistantId: number | null = null;
  try {
    const provider = getActiveProvider();
    const messages = buildTurnMessages(session.history, input);
    // Models without tool support get a tool-free chat mode automatically (spec 4.2).
    const currentModel = session.models.find((model) => model.id === modelId);
    const toolCapable = !currentModel || isToolCapable(currentModel);
    const tools = toolCapable ? { ...getTools(), ...(auto ? { askExpert: createAskExpertTool(autoState) } : {}) } : {};
    const note = !toolCapable ? CHAT_ONLY_NOTE : auto ? AUTO_NOTE.replaceAll('{{ADDRESS}}', getAddress() ?? 'Sir') : '';
    const result = await provider.stream({
      modelId,
      messages,
      tools,
      instructions: getSystemPrompt() + note,
      abortSignal: stop.signal,
      beforeStep: async ({ stepFailures, stepCosts, messages: stepMessages }) => {
        for (const cost of stepCosts.slice(countedSteps)) reportSpend(cost);
        countedSteps = stepCosts.length;
        if (!(await withinLimits())) {
          stop.abort();
          return {};
        }
        // In Auto mode the expert takes over the rest of a job the worker keeps failing.
        let stepModel: string | undefined;
        if (auto && (autoState.expertTookOver || shouldTakeOver(stepFailures))) {
          autoState.expertTookOver = true;
          stepModel = AUTO_EXPERT_MODEL;
          session.setActiveModel(AUTO_EXPERT_MODEL);
        }
        const tidied = clearOldToolResults(stepMessages);
        return { modelId: stepModel, messages: tidied.freedTokens > 0 ? tidied.messages : undefined };
      },
      onToken: (token) => {
        if (assistantId === null) assistantId = session.startAssistant();
        session.appendToken(assistantId, token);
      },
      onReasoning: (delta) => {
        if (session.verbose) session.appendReasoning(delta);
      },
      onToolCall: () => {
        // Hide pre-tool chatter so only the final answer stays visible (spec 2.3).
        if (assistantId !== null) session.setAssistantText(assistantId, '');
        session.closeReasoningEntry();
      },
    });
    if (assistantId === null) assistantId = session.startAssistant();
    session.setAssistantText(assistantId, result.text);
    session.finishAssistant(assistantId);
    session.setHistory([...messages, ...result.messages]);
    session.setLastReasoning(result.reasoning);
    session.addUsage(result.usage.input, result.usage.output, result.cost, result.usage.cached ?? 0);
    session.setRateLimit(result.rateLimit);
    void refreshCredit();
    for (const cost of (result.stepCosts ?? []).slice(countedSteps)) reportSpend(cost);
    session.setPlanResetAt(null);
    session.setActiveModel(auto ? AUTO_WORKER_MODEL : null);
    endJob();
    session.setStatus('idle');
  } catch (error) {
    endJob();
    session.setActiveModel(auto ? AUTO_WORKER_MODEL : null);
    if (stop.signal.aborted) {
      if (assistantId !== null) session.finishAssistant(assistantId);
      session.addNotice('Stopped, as you asked - nothing more will be spent on this.');
      session.setStatus('idle');
      return;
    }
    const plain = plainError(error, session.providerId);
    if (assistantId !== null) session.finishAssistant(assistantId);
    session.addError(plain.message);
    if (plain.resetAt !== undefined) session.setPlanResetAt(plain.resetAt);
    // The technical text stays off screen unless /verbose is on.
    if (session.verbose && plain.detail) session.addNotice(`Technical details: ${plain.detail}`);
    session.setStatus(DISCONNECTING.has(plain.kind) ? 'disconnected' : 'idle');
  }
}