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

describe('the last rung: the strongest model, only after asking', () => {
  it('asks in plain words, with the price difference from the catalogue', async () => {
    const { topModelQuestion, topModelPriceRatio } = await import('../src/agent/auto.js');
    const { AUTO_EXPERT_MODEL, AUTO_TOP_MODEL } = await import('../src/agent/auto-ids.js');
    const ratio = topModelPriceRatio(
      [
        { id: AUTO_EXPERT_MODEL, promptPrice: 0.000002 },
        { id: AUTO_TOP_MODEL, promptPrice: 0.000005 },
      ],
      AUTO_EXPERT_MODEL,
      AUTO_TOP_MODEL
    );
    expect(ratio).toBeCloseTo(2.5);
    expect(topModelQuestion('Sir', ratio)).toBe(
      'This is proving difficult, Sir. Shall I try the strongest model (Claude Opus 5) for this job? It costs about 2.5× as much as the expert. (y/n)'
    );
    expect(topModelQuestion('Madam', null)).toBe('This is proving difficult, Madam. Shall I try the strongest model (Claude Opus 5) for this job? (y/n)');
  });

  it('counts only failures after the expert took over', () => {
    const failures = [1, 1, 0, 0, 1];
    const takeoverStep = 2;
    expect(shouldTakeOver(failures)).toBe(false);
    expect(shouldTakeOver([...failures, 1].slice(takeoverStep))).toBe(true);
  });
});

describe('when a model is retired', () => {
  const entry = (id: string, tools = true) => ({ id, supportedParameters: tools ? ['tools'] : [] });

  it('uses the first replacement still in the catalogue that can use tools', async () => {
    const { firstAvailable, WORKER_MODELS, EXPERT_MODELS } = await import('../src/agent/auto-ids.js');
    expect(firstAvailable(WORKER_MODELS, [entry('deepseek/deepseek-v4-flash'), entry('z-ai/glm-5.3')])).toBe('deepseek/deepseek-v4-flash');
    expect(firstAvailable(WORKER_MODELS, [entry('deepseek/deepseek-v4-flash', false), entry('z-ai/glm-5.3')])).toBe('z-ai/glm-5.3');
    expect(firstAvailable(WORKER_MODELS, [entry('z-ai/glm-5.3'), entry('z-ai/glm-5.3-flash')])).toBe('z-ai/glm-5.3-flash');
    expect(firstAvailable(EXPERT_MODELS, [entry('z-ai/glm-5.3'), entry('anthropic/claude-opus-5')])).toBe('z-ai/glm-5.3');
    expect(firstAvailable(WORKER_MODELS, [entry('some/other-model')])).toBeNull();
  });

  it('uses the first choice before the catalogue has loaded', async () => {
    const { firstAvailable, WORKER_MODELS } = await import('../src/agent/auto-ids.js');
    expect(firstAvailable(WORKER_MODELS, [])).toBe('deepseek/deepseek-v4-flash-0731');
  });

  it('switches Auto, research and summaries to the replacement automatically', async () => {
    const { workerModel, expertModel, workingModelId, AUTO_MODEL_ID } = await import('../src/agent/auto.js');
    const { readingModels } = await import('../src/tools/web/research.js');
    const model = (id: string) => ({ id, name: id, contextLength: 1, promptPrice: 1, completionPrice: 1, supportedParameters: ['tools'], provider: id.split('/')[0] });
    session.setModels([model('deepseek/deepseek-v4-flash'), model('z-ai/glm-5.3')], '');
    session.providerId = 'openrouter';
    session.setModel(AUTO_MODEL_ID);
    expect(workerModel()).toBe('deepseek/deepseek-v4-flash');
    expect(workingModelId(AUTO_MODEL_ID)).toBe('deepseek/deepseek-v4-flash');
    expect(expertModel()).toBe('z-ai/glm-5.3');
    expect(readingModels()[0]).toBe('deepseek/deepseek-v4-flash');
    session.setModels([], '');
  });
});
