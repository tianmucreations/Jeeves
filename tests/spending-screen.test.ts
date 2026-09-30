import { describe, it, expect, beforeEach } from 'vitest';
import { spendingLines } from '../src/commands/spending.js';
import { session } from '../src/state/session.js';
import { reportSpend } from '../src/agent/spending.js';
import { clearSpendLog } from '../src/platform/config.js';

const value = (lines: ReturnType<typeof spendingLines>, label: string) => lines.find((l) => l.label === label)?.value;
beforeEach(() => {
  clearSpendLog();
  session.setTodaySpend(0);
  session.setZaiQuota(null);
  session.setProvider('openrouter');
});
const now = new Date(2026, 8, 30, 15, 0); // Wednesday 30 Sept 2026

describe("What I've spent (Claude Code /cost, OpenCode stats - in plain words)", () => {
  it('shows today and this week against the limits, and the last 7 days by name', () => {
    reportSpend(0.5, false, new Date(2026, 8, 30, 9, 0));
    reportSpend(0.25, false, new Date(2026, 8, 29, 9, 0));
    session.setTodaySpend(0.5);
    const lines = spendingLines(now);
    expect(value(lines, 'Today')).toBe('$0.50 of $3.00');
    expect(value(lines, 'This week')).toMatch(/^\$0\.75 of \$/);
    const days = lines.slice(lines.findIndex((l) => l.label === 'The last 7 days') + 1, lines.findIndex((l) => l.label === 'Limits'));
    expect(days).toHaveLength(7);
    expect(days[0]).toEqual({ label: 'Today', value: '$0.50' });
    expect(days[1]).toEqual({ label: 'Yesterday', value: '$0.25' });
    expect(days[2].value).toBe('$0.00');
  });
  it('says what is left on the account or key, when the service tells', () => {
    session.setCredit(1, 10, 9, true);
    expect(value(spendingLines(now), 'Credit left on your account')).toBe('$9.00');
    session.setCredit(1, 10, 4, false);
    expect(value(spendingLines(now), 'Credit left on your key')).toBe('$4.00');
  });
  it('on a plan it says how much of the plan is used; on the ChatGPT plan, that it costs nothing extra', () => {
    session.setProvider('zai');
    session.setZaiQuota({ fiveHourPct: 12, weeklyPct: 99, fiveHourResetAt: null, weeklyResetAt: null });
    const lines = spendingLines(now);
    expect(lines[0]).toEqual({ label: 'Your Z.ai plan', value: '', heading: true });
    expect(value(lines, 'This 5-hour session')).toBe('12% used');
    expect(lines.filter((l) => l.label === 'This week').map((l) => l.value)).toContain('99% used');
    session.setProvider('chatgpt');
    expect(value(spendingLines(now), 'Cost')).toContain('included in your plan');
  });
});
