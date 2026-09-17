import type { ModelMessage } from 'ai';
import { session } from '../state/session.js';
import { getActiveProvider } from '../providers/index.js';
import { getSystemPrompt } from './systemPrompt.js';
import { DEFAULT_CONTEXT_TOKENS } from '../state/session.js';
import { ZAI_MODELS } from '../providers/zai.js';

// The model's identity and rulebook. AI SDK 7 rejects role:'system' messages in the
// messages array ("Use the instructions option instead"), so the prompt travels as
// streamText's instructions option via the provider layer (see loop.ts).
export { getSystemPrompt };

// Builds the message list for one turn; automatic summarisation of older turns (spec 3.3)
// is deferred until long-conversation handling lands.
export function buildTurnMessages(history: ModelMessage[], userText: string): ModelMessage[] {
  const userMessage: ModelMessage = { role: 'user', content: userText };
  return [...history, userMessage];
}

// How much the current model can hold in mind, from the model lists (OpenRouter's
// catalogue, or Z.ai's own list); the long-standing default when it isn't listed.
export function contextLimitFor(modelId: string, models: { id: string; contextLength: number }[]): number {
  const found = models.find((model) => model.id === modelId) ?? ZAI_MODELS.find((model) => model.id === modelId);
  return found && found.contextLength > 0 ? found.contextLength : DEFAULT_CONTEXT_TOKENS;
}

// The conversation is summarised automatically once it fills this share of the
// model's memory, so the user never has to watch a memory gauge. Matches the
// amber threshold the old info bar used for "getting full".
export const AUTO_SUMMARISE_AT = 0.7;

export function shouldAutoSummarise(conversationTokens: number, limit: number): boolean {
  return conversationTokens >= AUTO_SUMMARISE_AT * limit;
}

// A failed summary is never announced - the user could do nothing about it. It is
// retried quietly, but only after a few messages, so a service that keeps failing
// is not asked (and billed) for a summary on every single message.
export const SUMMARY_RETRY_AFTER = 3;
let messagesUntilRetry = 0;

export function summaryDue(conversationTokens: number, limit: number): boolean {
  if (messagesUntilRetry > 0) {
    messagesUntilRetry -= 1;
    return false;
  }
  return shouldAutoSummarise(conversationTokens, limit);
}

// Condenses the whole conversation into a single summary message so a model can
// continue without re-reading every turn: on a model switch, or automatically when
// the conversation grows long.
export async function summariseHistory(): Promise<void> {
  if (session.history.length === 0) return;
  session.setStatus('working');
  try {
    const provider = getActiveProvider();
    const messages: ModelMessage[] = [
      ...session.history,
      {
        role: 'user',
        content: 'Summarise this conversation so far as compact context a model can continue from. Reply with only the summary.',
      },
    ];
    const result = await provider.stream({
      modelId: session.model,
      messages,
      tools: {},
      instructions: getSystemPrompt(),
      onToken: () => {},
      onReasoning: () => {},
      onToolCall: () => {},
    });
    const summary = result.text.trim();
    // Success is silent - there is nothing for the user to do. Only a failure is
    // mentioned, because then the conversation was not shortened.
    if (summary) {
      session.setHistory([
        {
          role: 'user',
          content: `A summary of the conversation so far:\n\n${summary}\n\nContinue helping from this point.`,
        },
      ]);
    } else {
      messagesUntilRetry = SUMMARY_RETRY_AFTER;
    }
  } catch {
    messagesUntilRetry = SUMMARY_RETRY_AFTER;
  }
  session.setStatus('idle');
}