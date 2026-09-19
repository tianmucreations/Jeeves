import { describe, it, expect } from 'vitest';
import { streamText, tool, stepCountIs } from 'ai';
import { MockLanguageModelV4, convertArrayToReadableStream, simulateReadableStream } from 'ai/test';
import { z } from 'zod';
import { silenceGuard } from '../src/providers/silence.js';

const usage = { inputTokens: { total: 1 }, outputTokens: { total: 1 } } as never;
const finish = (reason: string) => ({ type: 'finish', finishReason: { unified: reason, raw: reason }, usage }) as const;

async function run(model: MockLanguageModelV4, toolMs: number, silenceMs: number): Promise<string> {
  const guard = silenceGuard(undefined, silenceMs);
  const result = streamText({
    model,
    prompt: 'go',
    stopWhen: stepCountIs(3),
    abortSignal: guard.signal,
    tools: { slow: tool({ inputSchema: z.object({}), execute: async () => { await new Promise((r) => setTimeout(r, toolMs)); return 'ok'; } }) },
    onError: () => {},
  });
  let error: unknown = null;
  try {
    for await (const part of result.stream) {
      guard.onPart(part);
      if (part.type === 'error') error = part.error;
    }
    guard.stop();
  } catch (thrown) {
    // The providers let this reach loop.ts, which says it plainly (errors.ts).
    error = thrown;
  }
  return error ? `stopped: ${String((error as Error).name ?? error)}` : `finished: ${await result.text}`;
}

describe('the silence watchdog (19 Sept: a long install cancelled the job and blamed Z.ai)', () => {
  it('a command that runs longer than the silence limit does not cancel the job', async () => {
    let call = 0;
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: convertArrayToReadableStream(
          ++call === 1
            ? [{ type: 'stream-start', warnings: [] }, { type: 'tool-call', toolCallId: 't1', toolName: 'slow', input: '{}' }, finish('tool-calls')]
            : [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'a' }, { type: 'text-delta', id: 'a', delta: 'done' }, { type: 'text-end', id: 'a' }, finish('stop')],
        ),
      }),
    });
    expect(await run(model, 600, 200)).toBe('finished: done');
  });

  it('a reply that really goes silent is still stopped', async () => {
    const model = new MockLanguageModelV4({
      doStream: async () => ({
        stream: simulateReadableStream({
          chunks: [{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 'a' }, { type: 'text-delta', id: 'a', delta: 'hel' }, { type: 'text-delta', id: 'a', delta: 'lo' }, { type: 'text-end', id: 'a' }, finish('stop')] as never,
          initialDelayInMs: 0,
          chunkDelayInMs: 600,
        }),
      }),
    });
    expect(await run(model, 0, 200)).toBe('stopped: TimeoutError');
  });
});
