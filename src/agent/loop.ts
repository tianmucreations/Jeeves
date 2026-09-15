import { session } from '../state/session.js';
import { getActiveProvider } from '../providers/index.js';
import { getTools } from '../tools/index.js';
import { buildTurnMessages } from './context.js';

export async function runTurn(input: string): Promise<void> {
  session.addUser(input);
  const assistantId = session.startAssistant();
  session.setStatus('working');
  try {
    const provider = getActiveProvider();
    const messages = buildTurnMessages(session.history, input);
    const result = await provider.stream({
      modelId: session.model,
      messages,
      tools: getTools(),
      onToken: (token) => session.appendToken(assistantId, token),
      onToolCall: () => {},
    });
    session.setAssistantText(assistantId, result.text);
    session.finishAssistant(assistantId);
    session.setHistory([...messages, ...result.messages]);
    session.setReasoning(result.reasoning);
    session.addUsage(result.usage.input, result.usage.output, result.cost);
    session.setStatus('idle');
  } catch (error) {
    session.finishAssistant(assistantId);
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