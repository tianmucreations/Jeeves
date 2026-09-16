import type { ModelMessage } from 'ai';
import { session } from '../state/session.js';
import { getActiveProvider } from '../providers/index.js';
import { getSystemPrompt } from './systemPrompt.js';

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

// Condenses the whole conversation into a single summary message so a newly
// selected model can continue without re-reading every turn.
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
    if (summary) {
      session.setHistory([
        {
          role: 'user',
          content: `A summary of the conversation so far:\n\n${summary}\n\nContinue helping from this point.`,
        },
      ]);
      session.addNotice('Conversation summarised for the new model.');
    } else {
      session.addNotice('Could not summarise - kept the conversation as-is.');
    }
  } catch {
    session.addNotice('Could not summarise - kept the conversation as-is.');
  }
  session.setStatus('idle');
}