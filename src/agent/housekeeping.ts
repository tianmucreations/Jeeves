import type { ModelMessage } from 'ai';

// Quiet housekeeping that keeps the conversation small, because every message
// re-sends the whole conversation. Modelled on Anthropic's published context
// editing (platform.claude.com/docs/en/build-with-claude/context-editing): old
// tool results are cleared first - they are the bulk, and a file can simply be
// read again - keeping the most recent 3, and only when enough is freed to be
// worth losing the prompt-cache discount for one message. The trigger and minimum
// are the figures from Anthropic's own worked example (30,000 and 5,000 tokens);
// their default trigger is 100,000, which is where summarising starts.

export const CLEAR_TRIGGER_TOKENS = 30_000;
export const CLEAR_AT_LEAST_TOKENS = 5_000;
export const KEEP_RECENT_TOOL_RESULTS = 3;
export const SUMMARY_TRIGGER_TOKENS = 100_000;
export const CLEARED_PLACEHOLDER =
  '[Earlier output removed to keep the conversation small. Run the tool again if it is needed.]';

// The same rough measure used elsewhere in the app: about 4 characters per token.
export function estimateTokens(value: unknown): number {
  return Math.ceil(JSON.stringify(value).length / 4);
}

export interface ClearResult {
  messages: ModelMessage[];
  freedTokens: number;
}

export function clearOldToolResults(messages: ModelMessage[]): ClearResult {
  if (estimateTokens(messages) < CLEAR_TRIGGER_TOKENS) return { messages, freedTokens: 0 };
  const positions: { message: number; part: number }[] = [];
  messages.forEach((message, messageIndex) => {
    if (message.role !== 'tool' || !Array.isArray(message.content)) return;
    message.content.forEach((part, partIndex) => {
      if (part.type === 'tool-result') positions.push({ message: messageIndex, part: partIndex });
    });
  });
  const older = positions.slice(0, Math.max(0, positions.length - KEEP_RECENT_TOOL_RESULTS));
  let freed = 0;
  const copy = messages.map((message) =>
    message.role === 'tool' && Array.isArray(message.content) ? { ...message, content: [...message.content] } : message
  ) as ModelMessage[];
  for (const { message, part } of older) {
    const content = (copy[message] as { content: { type: string; output?: unknown }[] }).content;
    const result = content[part] as { output?: { type: string; value?: unknown } };
    if (result.output?.type === 'text' && result.output.value === CLEARED_PLACEHOLDER) continue;
    const before = estimateTokens(result.output);
    const replacement = { type: 'text' as const, value: CLEARED_PLACEHOLDER };
    freed += before - estimateTokens(replacement);
    content[part] = { ...result, output: replacement } as (typeof content)[number];
  }
  if (freed < CLEAR_AT_LEAST_TOKENS) return { messages, freedTokens: 0 };
  return { messages: copy, freedTokens: freed };
}

// Anthropic's structured summary (the five parts of their compaction prompt), so a
// summary keeps what matters for carrying on with the job.
export const SUMMARY_INSTRUCTIONS = `Summarise the conversation so far so the work can continue from the summary alone. Use exactly these headings:
1. Task overview - what the person asked for and what counts as done.
2. Current state - what has been completed, which files were changed or created.
3. Important discoveries - facts checked, decisions made, errors met and how they were resolved, approaches that failed.
4. Next steps - what remains, in order, and anything blocking it.
5. Context to preserve - the person's preferences, how they like to be addressed, promises made.
Be specific: keep exact file names, figures, and quoted facts. Reply with only the summary.`;
