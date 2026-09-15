import type { ModelMessage } from 'ai';

// Builds the message list for one turn; automatic summarisation of older turns (spec 3.3)
// is deferred until long-conversation handling lands.
export function buildTurnMessages(history: ModelMessage[], userText: string): ModelMessage[] {
  const userMessage: ModelMessage = { role: 'user', content: userText };
  return [...history, userMessage];
}