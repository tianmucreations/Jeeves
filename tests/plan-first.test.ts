import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { togglePlanMode, planBlock } from '../src/agent/plan.js';
import { answerOption, answerQuestion, questionOpen } from '../src/agent/question.js';
import { TOOLS } from '../src/tools/index.js';
import { session } from '../src/state/session.js';
import { getSystemPrompt } from '../src/agent/systemPrompt.js';
import { hasPendingApproval } from '../src/agent/permissions.js';
import { footerSegments } from '../src/components/Footer.js';

const options = { toolCallId: 't', messages: [] } as never;
const waitForQuestion = async () => {
  for (let i = 0; i < 200 && !questionOpen(); i++) await new Promise((r) => setTimeout(r, 5));
  expect(questionOpen()).toBe(true);
};
beforeEach(() => session.setPlanMode(false));

describe('plan first (Claude Code plan mode / OpenCode plan agent)', () => {
  it('turns on and off, tells the model, and shows in the bottom bar', () => {
    expect(togglePlanMode()).toContain('ON');
    expect(session.planMode).toBe(true);
    expect(getSystemPrompt()).toContain('PLAN FIRST IS ON');
    const base = { providerId: 'zai', allowance: null, tidying: false, busyNote: null, todaySpend: 0, creditRemaining: null, creditIsAccount: false, planResetAt: null, connected: true, planFirst: true } as never;
    expect(footerSegments(base)[0].text).toBe('plan first');
    expect(togglePlanMode()).toContain('off');
    expect(planBlock()).toBe('');
    expect(getSystemPrompt()).not.toContain('PLAN FIRST IS ON');
  });
  it('refuses anything that changes things - before any question - but lets looking around through', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jeeves-plan-'));
    session.setPlanMode(true);
    await expect(TOOLS.writeFile.execute!({ path: path.join(dir, 'a.txt'), content: 'x' }, options)).rejects.toThrow('plan first is on');
    await expect(TOOLS.runBash.execute!({ command: `touch ${path.join(dir, 'b.txt')}` }, options)).rejects.toThrow('plan first is on');
    expect(hasPendingApproval()).toBe(false);
    await expect(readFile(path.join(dir, 'a.txt'))).rejects.toThrow();
    expect(String(await TOOLS.listDir.execute!({ path: dir }, options))).not.toContain('a.txt');
    await rm(dir, { recursive: true, force: true });
  });
  it('showing the plan asks; Go ahead turns plan first off and tells the model', async () => {
    session.setPlanMode(true);
    const call = TOOLS.presentPlan.execute!({ plan: '1. Look at the files\n2. Rename them' }, options);
    await waitForQuestion();
    expect(session.transcript.some((e) => e.kind === 'notice' && e.text.includes('The plan:'))).toBe(true);
    expect(session.question?.options.map((o) => o.label)).toEqual(['Go ahead', 'Change the plan']);
    answerOption(0);
    expect(String(await call)).toContain('approved');
    expect(session.planMode).toBe(false);
  });
  it('typed feedback keeps plan first on and goes back to the model', async () => {
    session.setPlanMode(true);
    const call = TOOLS.presentPlan.execute!({ plan: '1. Do it' }, options);
    await waitForQuestion();
    answerQuestion('do the summary first');
    expect(String(await call)).toContain('do the summary first');
    expect(session.planMode).toBe(true);
  });
});

describe('the model offers planning first by itself (nobody has to remember a mode)', () => {
  it('Yes turns plan first on', async () => {
    session.setPlanMode(false);
    const call = TOOLS.offerPlan.execute!({ reason: 'it touches many files' }, options);
    await waitForQuestion();
    expect(session.question?.question).toContain('big job (it touches many files)');
    expect(session.question?.options[0].label).toContain('(Recommended)');
    answerOption(0);
    expect(String(await call)).toContain('now ON');
    expect(session.planMode).toBe(true);
  });
  it('No leaves it off and tells the model to carry on', async () => {
    session.setPlanMode(false);
    const call = TOOLS.offerPlan.execute!({}, options);
    await waitForQuestion();
    answerOption(1);
    expect(String(await call)).toContain('go ahead without a plan');
    expect(session.planMode).toBe(false);
  });
  it('asks nothing when plan first is already on', async () => {
    session.setPlanMode(true);
    expect(String(await TOOLS.offerPlan.execute!({}, options))).toContain('already on');
    expect(questionOpen()).toBe(false);
  });
});
