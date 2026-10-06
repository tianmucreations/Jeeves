import { session } from '../state/session.js';
import { spentThisSession, allowanceToday, spentThisWeek, allowanceThisWeek } from '../agent/spending.js';
import { getSpendLog } from '../platform/config.js';
import { localDate } from '../state/today-spend.js';

// "What I've spent", in plain words: today and this week against the limits, what is left, and the
// last seven days. Claude Code's /cost shows the session's total cost (and, on a plan, the plan's own
// usage); OpenCode's `stats` shows total cost, tokens and days. Jeeves keeps a per-day log already,
// so the same picture is one screen, worded for a person - the same lines in the terminal and the window.
export interface SpendLine {
  label: string;
  value: string;
  // A heading line (no value).
  heading?: boolean;
}

const money = (amount: number) => `$${amount.toFixed(2)}`;

function dayName(date: Date, today: Date): string {
  const days = Math.round((Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) - Date.UTC(date.getFullYear(), date.getMonth(), date.getDate())) / 86_400_000);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return date.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'short' });
}

export function spendingLines(now = new Date()): SpendLine[] {
  const lines: SpendLine[] = [];
  const onPlan = session.providerId === 'zai' && session.zaiQuota;
  const inPlan = session.providerId === 'chatgpt';
  if (onPlan) {
    const quota = session.zaiQuota!;
    lines.push({ label: 'Your Z.ai plan', value: '', heading: true });
    lines.push({ label: 'This 5-hour session', value: `${quota.fiveHourPct}% used` });
    lines.push({ label: 'This week', value: `${quota.weeklyPct}% used` });
  } else if (inPlan) {
    lines.push({ label: 'Your ChatGPT plan', value: '', heading: true });
    lines.push({ label: 'Cost', value: 'included in your plan - nothing extra for each use' });
  }
  lines.push({ label: 'Spent', value: '', heading: true });
  lines.push({ label: 'Today', value: `${money(session.todaySpend ?? 0)} of ${money(allowanceToday(now))}` });
  lines.push({ label: 'This week', value: `${money(spentThisWeek(now))} of ${money(allowanceThisWeek(now))}` });
  lines.push({ label: 'Since Jeeves opened', value: money(spentThisSession()) });
  if (session.creditRemaining !== null) {
    lines.push({ label: session.creditIsAccount ? 'Credit left on your account' : 'Credit left on your key', value: money(session.creditRemaining) });
  }
  lines.push({ label: 'The last 7 days', value: '', heading: true });
  const log = getSpendLog();
  for (let back = 0; back < 7; back++) {
    const date = new Date(now.getFullYear(), now.getMonth(), now.getDate() - back);
    lines.push({ label: dayName(date, now), value: money(log[localDate(date)] ?? 0) });
  }
  lines.push({ label: 'Limits', value: '', heading: true });
  lines.push({ label: 'Change them', value: 'Settings, then the daily or weekly spending limit' });
  return lines;
}
