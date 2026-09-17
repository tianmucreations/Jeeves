import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ModelMessage } from 'ai';

vi.mock('../src/agent/permissions.js', () => ({ requestApproval: vi.fn(async () => answer) }));
let answer = true;

const { clearOldToolResults, CLEARED_PLACEHOLDER, KEEP_RECENT_TOOL_RESULTS } = await import('../src/agent/housekeeping.js');
const { shouldTakeOver, countToolFailures, conversationForExpert, workingModelId, AUTO_MODEL_ID, AUTO_WORKER_MODEL } = await import('../src/agent/auto.js');
const spending = await import('../src/agent/spending.js');
const { session } = await import('../src/state/session.js');
const { setDailyExtra } = await import('../src/platform/config.js');

const toolTurn = (id: number, size: number): ModelMessage[] => [
  { role: 'assistant', content: [{ type: 'tool-call', toolCallId: `c${id}`, toolName: 'readFile', input: { path: `f${id}` } }] },
  { role: 'tool', content: [{ type: 'tool-result', toolCallId: `c${id}`, toolName: 'readFile', output: { type: 'text', value: 'x'.repeat(size) } }] },
];

describe('housekeeping', () => {
  it('leaves a small conversation alone', () => {
    const messages = [...toolTurn(1, 1000), ...toolTurn(2, 1000)];
    expect(clearOldToolResults(messages)).toEqual({ messages, freedTokens: 0 });
  });

  it('clears old tool output past the trigger, keeping the latest 3 and every call', () => {
    const messages = [1, 2, 3, 4, 5, 6].flatMap((id) => toolTurn(id, 40_000));
    const { messages: tidied, freedTokens } = clearOldToolResults(messages);
    expect(freedTokens).toBeGreaterThan(20_000);
    const outputs = tidied.filter((m) => m.role === 'tool').map((m) => ((m.content as any)[0].output.value as string));
    expect(outputs.slice(0, 3)).toEqual([CLEARED_PLACEHOLDER, CLEARED_PLACEHOLDER, CLEARED_PLACEHOLDER]);
    expect(outputs.slice(3).every((v) => v.length === 40_000)).toBe(true);
    expect(KEEP_RECENT_TOOL_RESULTS).toBe(3);
    expect(tidied.filter((m) => m.role === 'assistant').length).toBe(6);
    // The original conversation object is not changed.
    expect(((messages[1].content as any)[0].output.value as string).length).toBe(40_000);
  });

  it('does nothing when clearing would free too little to be worth it', () => {
    const messages = [...toolTurn(1, 2_000), ...[2, 3, 4].flatMap((id) => toolTurn(id, 45_000))];
    expect(clearOldToolResults(messages).freedTokens).toBe(0);
  });
});

describe('auto mode', () => {
  it('uses the cheap worker behind the Auto choice', () => {
    expect(workingModelId(AUTO_MODEL_ID)).toBe(AUTO_WORKER_MODEL);
    expect(workingModelId('anthropic/claude-fable-5')).toBe('anthropic/claude-fable-5');
  });

  it('hands over to the expert after two failures in the last three steps', () => {
    expect(shouldTakeOver([0, 1, 0])).toBe(false);
    expect(shouldTakeOver([1, 0, 1])).toBe(true);
    expect(shouldTakeOver([2])).toBe(true);
    expect(shouldTakeOver([1, 0, 0, 1])).toBe(false);
  });

  it('does not count a person saying no as a failure', () => {
    expect(countToolFailures([
      { type: 'tool-error', error: new Error('ENOENT') },
      { type: 'tool-error', error: new Error('Permission denied by the user - runBash rm x was not executed.') },
      { type: 'tool-result' },
    ])).toBe(1);
  });

  it('gives the expert a readable, shortened copy of the job', () => {
    const text = conversationForExpert([{ role: 'user', content: 'fix the test' }, ...toolTurn(1, 5_000)]);
    expect(text).toContain('USER: fix the test');
    expect(text).toContain('ACTION readFile: {"path":"f1"}');
    expect(text).toContain('…[shortened]');
    expect(text.length).toBeLessThan(2_300);
  });
});

describe('spending limits', () => {
  beforeEach(() => {
    session.setDailyLimit(3, 0);
    setDailyExtra({ date: '2000-01-01', amount: 0 });
    session.todaySpend = 0;
    session.transcript = [];
    answer = true;
  });

  it('counts reported costs towards the job and today', () => {
    spending.startJob();
    spending.reportSpend(0.12);
    spending.reportSpend(0.05);
    expect(spending.jobSpent()).toBeCloseTo(0.17);
    expect(session.todaySpend).toBeCloseTo(0.17);
    spending.endJob();
  });

  it('asks before a job passes each 50 cents, and stops on no', async () => {
    spending.startJob();
    spending.reportSpend(0.3);
    expect(await spending.withinLimits()).toBe(true);
    spending.reportSpend(0.25);
    answer = false;
    expect(await spending.withinLimits()).toBe(false);
    expect(session.transcript.at(-1)).toMatchObject({ kind: 'notice', text: 'This job has cost about $0.55 so far. Keep going? (y/n)' });
    spending.endJob();
  });

  it("at the daily limit asks to allow another day's worth, remembered for today only", async () => {
    const now = new Date(2030, 0, 1, 12);
    session.todaySpend = 3.05;
    expect(await spending.withinLimits(now)).toBe(true);
    expect(session.transcript.at(-1)).toMatchObject({ text: "Today's $3.00 spending limit is reached. Allow another $3.00 today? (y/n)" });
    expect(spending.allowanceToday(now)).toBe(6);
    expect(spending.allowanceToday(new Date(2030, 0, 2, 12))).toBe(3);
    answer = false;
    session.todaySpend = 6.2;
    expect(await spending.withinLimits(now)).toBe(false);
    setDailyExtra({ date: '2000-01-01', amount: 0 });
  });
});
