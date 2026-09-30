import { z } from 'zod';
import { session } from '../state/session.js';
import { askQuestion } from './question.js';

// Plan first, as Claude Code's plan mode (EnterPlanMode / ExitPlanMode) and OpenCode's
// plan agent: while it is on Jeeves may only look around - nothing is changed, no
// command that changes things runs - until it has shown its plan and the person has
// said yes. Turned on from Settings (or by asking); off again by approving the plan.
export const presentPlanSchema = z.object({
  plan: z.string().min(1).describe('The plan in plain words: a short numbered list of what you will do, and what the person will end up with'),
});

export const PLAN_RULES = `PLAN FIRST IS ON. The person wants to see your plan before anything is changed.
Look around as much as you need (readFile, listDir, searchFiles, findFiles, searches, read-only commands). Do NOT write, edit or run anything that changes things - it will be refused.
When you understand the job, call presentPlan with a short numbered plan in plain words. Then wait: the person approves it or asks for changes. Only after they approve may you carry it out.`;

export function planBlock(): string {
  return session.planMode ? `\n\n${PLAN_RULES}` : '';
}

export function togglePlanMode(): string {
  session.setPlanMode(!session.planMode);
  return session.planMode
    ? "Plan first is ON - I'll look around, show you my plan, and wait for your yes before changing anything."
    : 'Plan first is off - I will go ahead and do things as usual (still asking before changes).';
}

export async function runPresentPlan(input: z.output<typeof presentPlanSchema>): Promise<string> {
  session.addNotice(`The plan:\n${input.plan.trim()}`);
  const answer = await askQuestion({
    question: 'Go ahead with this plan?',
    options: [{ label: 'Go ahead', description: 'do it as planned' }, { label: 'Change the plan', description: 'tell me what to change' }],
  });
  if (answer === 'Go ahead') {
    session.setPlanMode(false);
    return 'The person approved the plan. Plan first is now off: carry out the plan.';
  }
  if (answer === '') return 'The person did not answer (they stopped the job). Nothing was changed.';
  if (answer === 'Change the plan') return 'The person wants the plan changed. Ask what they would like different, then present a new plan.';
  return `The person's feedback on the plan: ${answer}. Present a revised plan.`;
}

// The model suggests planning first for a big or unclear job - the person just clicks
// Yes or No (Claude Code's EnterPlanMode and OpenCode's plan_enter both ask first;
// nobody has to know a mode exists or remember to switch it on).
export const offerPlanSchema = z.object({
  reason: z.string().optional().describe('Why this job is worth planning first, in a few plain words'),
});

export async function runOfferPlan(input: z.output<typeof offerPlanSchema>): Promise<string> {
  if (session.planMode) return 'Plan first is already on. Look around, then call presentPlan.';
  const answer = await askQuestion({
    question: input.reason ? `This looks like a big job (${input.reason.trim().replace(/[.]+$/, '')}). Want me to plan it first?` : 'This looks like a big job. Want me to plan it first?',
    options: [
      { label: 'Yes, plan it first (Recommended)', description: 'I show you the plan before changing anything' },
      { label: 'No, just do it', description: 'go ahead straight away' },
    ],
  });
  if (answer.startsWith('Yes')) {
    session.setPlanMode(true);
    return 'Plan first is now ON. Look around (read only), then call presentPlan with your plan. Do not change anything until it is approved.';
  }
  if (answer === '') return 'The person did not answer (they stopped the job).';
  if (answer.startsWith('No')) return 'The person chose to go ahead without a plan. Carry on with the job.';
  return `The person said: ${answer}. Follow that.`;
}
