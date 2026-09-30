import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Provider, StreamOptions, StreamResult } from '../src/providers/types.js';

const calls: StreamOptions[] = [];
let inFlight = 0;
let peak = 0;
let delay = 0;
let replyText = 'Found it in letters/landlord.txt line 2.';
const fake: Provider = {
  id: 'fake',
  name: 'Fake',
  async stream(options: StreamOptions): Promise<StreamResult> {
    calls.push(options);
    inFlight++;
    peak = Math.max(peak, inFlight);
    if (delay) await new Promise((r) => setTimeout(r, delay));
    inFlight--;
    return { text: replyText, reasoning: '', messages: [], usage: { input: 1, output: 1, total: 2 }, cost: 0, rateLimit: null, stepCosts: [0.01, 0.02] };
  },
};
vi.mock('../src/providers/index.js', async (original) => ({ ...(await original<typeof import('../src/providers/index.js')>()), getActiveProvider: () => fake }));

const { TOOLS } = await import('../src/tools/index.js');
const { HELPER_RULES } = await import('../src/agent/helper.js');
const { spentThisSession } = await import('../src/agent/spending.js');
const options = { toolCallId: 't', messages: [] } as never;

beforeEach(() => {
  calls.length = 0;
  inFlight = 0;
  peak = 0;
  delay = 0;
  replyText = 'Found it in letters/landlord.txt line 2.';
});

describe('helpers (Claude Code Agent tool, OpenCode task tool)', () => {
  it('runs in a conversation of its own with only the task, and hands back its short report', async () => {
    const report = await TOOLS.helper.execute!({ task: 'Find which letter mentions the heating and say which line.' }, options);
    expect(report).toBe('Found it in letters/landlord.txt line 2.');
    expect(calls).toHaveLength(1);
    expect(calls[0].messages).toEqual([{ role: 'user', content: 'Find which letter mentions the heating and say which line.' }]);
    expect(calls[0].instructions).toBe(HELPER_RULES);
  });
  it('can only look: no writing, editing, commands, questions, memory - and no helpers of its own', async () => {
    await TOOLS.helper.execute!({ task: 'look around' }, options);
    expect(Object.keys(calls[0].tools).sort()).toEqual(['findFiles', 'listDir', 'readFile', 'readWebPage', 'searchFiles', 'webSearch']);
  });
  it('its spending is counted, and an empty answer is said plainly', async () => {
    const before = spentThisSession();
    replyText = '   ';
    expect(await TOOLS.helper.execute!({ task: 'x' }, options)).toBe('The helper found nothing to report.');
    expect(spentThisSession() - before).toBeCloseTo(0.03, 5);
  });
  it('at most three go at once; the rest wait their turn, and all finish', async () => {
    delay = 40;
    const all = await Promise.all(Array.from({ length: 6 }, (_, i) => TOOLS.helper.execute!({ task: `job ${i}` }, options)));
    expect(all).toHaveLength(6);
    expect(calls).toHaveLength(6);
    expect(peak).toBe(3);
  });
});
