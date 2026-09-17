import { describe, it, expect, vi } from 'vitest';

const stream = vi.fn(async () => {
  throw new Error('fetch failed');
});
vi.mock('../src/providers/index.js', () => ({ getActiveProvider: () => ({ id: 'mock', name: 'mock', stream }) }));

const { summariseHistory, summaryDue, SUMMARY_RETRY_AFTER } = await import('../src/agent/context.js');
const { session } = await import('../src/state/session.js');

describe('a failed summary', () => {
  it('shows nothing, and is retried only after a few messages', async () => {
    session.transcript = [];
    session.setHistory([{ role: 'user', content: 'hello' }]);
    expect(summaryDue(150_000, 200_000)).toBe(true);
    await summariseHistory();
    expect(stream).toHaveBeenCalledTimes(1);
    expect(session.transcript).toEqual([]);
    expect(session.history).toEqual([{ role: 'user', content: 'hello' }]);
    for (let i = 0; i < SUMMARY_RETRY_AFTER; i++) expect(summaryDue(150_000, 200_000)).toBe(false);
    expect(summaryDue(150_000, 200_000)).toBe(true);
  });
});
