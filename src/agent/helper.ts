import { z } from 'zod';
import type { ToolSet } from 'ai';
import { session } from '../state/session.js';
import { getActiveProvider } from '../providers/index.js';
import type { Provider } from '../providers/types.js';
import { workingModelId } from './auto.js';
import { reportStepCost } from './spending.js';
import { isToolCapable } from '../models/filter.js';

// Helpers: the main AI sends a helper off to look into something, in a conversation of its own, and gets
// back one short report - so a big search or piece of research does not fill the main conversation, and
// several can go at once. Claude Code's Agent tool and OpenCode's task tool do this (a fresh conversation
// with its own tools, one final message back, several in parallel, "the result is not visible to the
// person"). Here a helper can only LOOK - read, list, search, use the web - never change anything, so no
// permission question can ever come from one; and it cannot send helpers of its own.
export const helperSchema = z.object({
  task: z.string().min(1).describe('Everything the helper needs to know, and exactly what to report back. It sees nothing of this conversation.'),
});

export const HELPER_RULES = `You are a helper for Jeeves, sent to look into one thing and report back. You can read files, list folders, search inside files, find files by name, and search the web - you cannot change anything or run commands.
Do exactly the task. When you have what was asked for, stop and write a short plain report: the facts you found, and the file paths or web pages they came from. No greetings, no describing your working. If you could not find it, say so plainly.`;

// At most this many helpers work at once; more wait their turn (each one is a paid conversation).
const MAX_AT_ONCE = 3;
let working = 0;
// Each waiter carries its own stop signal, so "Stop" releases it instead of
// leaving it queued forever (the old version leaked waiters on every stop).
const waiting: { resolve: () => void; signal: AbortSignal | undefined; onAbort: (() => void) | null }[] = [];

async function acquire(signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw aborted();
  if (working < MAX_AT_ONCE) {
    working++;
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const entry = { resolve, signal, onAbort: null as (() => void) | null };
    if (signal) {
      entry.onAbort = () => {
        const index = waiting.indexOf(entry);
        if (index >= 0) waiting.splice(index, 1);
        reject(aborted());
      };
      signal.addEventListener('abort', entry.onAbort, { once: true });
    }
    waiting.push(entry);
  });
}

function aborted(): Error {
  // Named as the SDK names its own, so the plain-English "stopped" path stays the same.
  const error = new Error('This helper was stopped.');
  error.name = 'AbortError';
  return error;
}

function release(): void {
  const next = waiting.shift();
  if (next) {
    if (next.onAbort && next.signal) next.signal.removeEventListener('abort', next.onAbort);
    next.resolve();
  } else {
    working--;
  }
}

export async function runHelper(
  input: z.output<typeof helperSchema>,
  deps: { tools: ToolSet; signal?: AbortSignal; provider?: Provider; modelId?: string }
): Promise<string> {
  await acquire(deps.signal);
  try {
    const provider = deps.provider ?? getActiveProvider();
    const modelId = deps.modelId ?? workingModelId(session.model);
    const info = session.models.find((model) => model.id === modelId);
    const result = await provider.stream({
      modelId,
      messages: [{ role: 'user', content: input.task }],
      // A model that cannot use tools can still answer from what the task itself says.
      tools: !info || isToolCapable(info) ? deps.tools : {},
      instructions: HELPER_RULES,
      onToken: () => {},
      onReasoning: () => {},
      onToolCall: () => {},
      abortSignal: deps.signal,
    });
    for (const cost of result.stepCosts ?? []) reportStepCost(cost);
    return result.text.trim() || 'The helper found nothing to report.';
  } finally {
    release();
  }
}
