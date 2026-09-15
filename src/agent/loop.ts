import { session } from '../state/session.js';
import { getActiveProvider, refreshCredit } from '../providers/index.js';
import { getTools } from '../tools/index.js';
import { buildTurnMessages } from './context.js';
import { toggleVerbose } from '../commands/verbose.js';
import { isToolCapable } from '../models/filter.js';

export async function runTurn(input: string): Promise<void> {
  if (input.startsWith('/') && input.length > 1 && !input.startsWith('/ ')) {
    if (input === '/verbose') {
      session.addNotice(toggleVerbose());
    } else if (input === '/model') {
      session.openPicker();
    } else if (input === '/keys') {
      session.openKeys();
    } else {
      session.addNotice('Unknown command. Try /model, /keys, or /verbose.');
    }
    return;
  }

  session.addUser(input);
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
    session.addUsage(result.usage.input, result.usage.output, result.cost);
    session.setRateLimit(result.rateLimit);
    void refreshCredit();
    session.setStatus('idle');
  } catch (error) {
    if (assistantId !== null) session.finishAssistant(assistantId);
    session.addError(describeError(error));
    session.setStatus(classifyStatus(error));
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function classifyStatus(error: unknown): 'idle' | 'disconnected' {
  const text = describeError(error).toLowerCase();
  const connectionProblems = ['api key', '401', 'unauthorized', 'fetch', 'network', 'dns', 'econnrefused', 'timeout'];
  if (connectionProblems.some((problem) => text.includes(problem))) {
    return 'disconnected';
  }
  return 'idle';
}