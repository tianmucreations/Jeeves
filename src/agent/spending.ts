import { session } from '../state/session.js';
import { requestApproval } from './permissions.js';
import { getDailyExtra, setDailyExtra, getEstimatedSpend, setEstimatedSpend } from '../platform/config.js';
import { isEstimatedCostService } from '../providers/direct-services.js';
import { localDate } from '../state/today-spend.js';

// Spending guard rails. Costs come from OpenRouter's own figures (the cost it reports
// for every step and every research or expert request), added live so the limits
// act during a job, not after it. The key's running total later corrects "today".

export const JOB_ASK_EVERY = 0.5;

interface JobMeter {
  spent: number;
  nextAsk: number;
}

let job: JobMeter | null = null;

export function startJob(): void {
  job = { spent: 0, nextAsk: JOB_ASK_EVERY };
}

export function endJob(): void {
  job = null;
}

export function jobSpent(): number {
  return job?.spent ?? 0;
}

let sessionTotal = 0;

// Everything reported since Jeeves started.
export function spentThisSession(): number {
  return sessionTotal;
}

// Every paid request reports here. A figure worked out from a price list (a direct
// connection) is also saved, so today's total survives a restart; OpenRouter's own
// figures are read back from OpenRouter instead.
export function reportSpend(amount: number | undefined, estimated = false, now = new Date()): void {
  if (!amount || amount <= 0) return;
  if (estimated) {
    const saved = getEstimatedSpend();
    const today = localDate(now);
    setEstimatedSpend({ date: today, amount: (saved && saved.date === today ? saved.amount : 0) + amount });
  }
  sessionTotal += amount;
  if (job) job.spent += amount;
  session.setTodaySpend((session.todaySpend ?? 0) + amount);
}

// Today's allowance: the daily limit plus any extra agreed today.
export function allowanceToday(now = new Date()): number {
  const extra = getDailyExtra();
  return session.dailyLimit + (extra && extra.date === localDate(now) ? extra.amount : 0);
}

async function ask(question: string): Promise<boolean> {
  session.addNotice(question);
  return requestApproval();
}

const money = (value: number) => `$${value.toFixed(2)}`;

// Checked before a job starts and before every step. Returns false to stop.
export async function withinLimits(now = new Date()): Promise<boolean> {
  const allowance = allowanceToday(now);
  if ((session.todaySpend ?? 0) >= allowance) {
    const more = await ask(`Today's ${money(allowance)} spending limit is reached. Allow another ${money(session.dailyLimit)} today? (y/n)`);
    if (!more) return false;
    const extra = getDailyExtra();
    const current = extra && extra.date === localDate(now) ? extra.amount : 0;
    setDailyExtra({ date: localDate(now), amount: current + session.dailyLimit });
  }
  if (job && job.spent >= job.nextAsk) {
    const more = await ask(`This job has cost about ${money(job.spent)} so far. Keep going? (y/n)`);
    if (!more) return false;
    job.nextAsk = job.spent + JOB_ASK_EVERY;
  }
  return true;
}

// A model's step costs, reported: estimated when the service in use is a direct connection.
export function reportStepCost(amount: number | undefined, providerId = session.providerId): void {
  reportSpend(amount, isEstimatedCostService(providerId));
}
