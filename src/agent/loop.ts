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
  // A long conversation is summarised before it fills the model's memory.
  if (summaryDue(session.estimateContextTokens(), contextLimitFor(session.model, session.models))) {
    await summariseHistory();
  }
  session.beginTurn();
  session.setStatus('working');
  let assistantId: number | null = null;
  try {
    const provider = getActiveProvider();
    const messages = buildTurnMessages(session.history, input);
    // Models without tool support get a tool-free chat mode automatically (spec 4.2).
    const currentModel = session.models.find((model) => model.id === session.model);
    const tools = !currentModel || isToolCapable(currentModel) ? getTools() : {};
    const result = await provider.stream({
      modelId: session.model,
      messages,
      tools,
      instructions: Object.keys(tools).length > 0 ? getSystemPrompt() : getSystemPrompt() + CHAT_ONLY_NOTE,
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
    session.setPlanResetAt(null);
    session.setStatus('idle');
  } catch (error) {
    const plain = plainError(error, session.providerId);
    if (assistantId !== null) session.finishAssistant(assistantId);
    session.addError(plain.message);
    if (plain.resetAt !== undefined) session.setPlanResetAt(plain.resetAt);
    // The technical text stays off screen unless /verbose is on.
    if (session.verbose && plain.detail) session.addNotice(`Technical details: ${plain.detail}`);
    session.setStatus(DISCONNECTING.has(plain.kind) ? 'disconnected' : 'idle');
  }
}