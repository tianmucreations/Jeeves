import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/agent/permissions.js', () => ({ requestApproval: vi.fn(async () => answer) }));
let answer = true;

const spending = await import('../src/agent/spending.js');
const { session } = await import('../src/state/session.js');
const { mondayOf, spendThisWeek } = await import('../src/state/week.js');
const {
  getWeeklyLimit,
  setWeeklyLimit,
  getWeeklyExtra,
  setWeeklyExtra,
  getSpendLog,
  addToSpendLog,
  correctSpendLogDay,
  clearSpendLog,
  setDailyExtra,
  setDailyLimit,
} = await import('../src/platform/config.js');
import { localDate } from '../src/state/today-spend.js';

// Thursday 24 September 2026, midday - a real date with no midnight edge cases.
const now = new Date(2026, 8, 24, 12, 0, 0);

describe('which days belong to this week', () => {
  it('runs Monday to Sunday, in the computer\'s own time zone', () => {
    expect(mondayOf(new Date(2026, 8, 24))).toBe('2026-09-21'); // Thursday
    expect(mondayOf(new Date(2026, 8, 21))).toBe('2026-09-21'); // Monday itself
    expect(mondayOf(new Date(2026, 8, 27))).toBe('2026-09-21'); // Sunday, still this week
    expect(mondayOf(new Date(2026, 8, 28))).toBe('2026-09-28'); // next Monday
    expect(mondayOf(new Date(2026, 8, 20))).toBe('2026-09-14'); // last Sunday, the week before
    expect(mondayOf(new Date(2026, 8, 1))).toBe('2026-08-31'); // across the month's edge
    expect(mondayOf(new Date(2026, 0, 1))).toBe('2025-12-29'); // across the year's edge
  });

  it("sums only this week's days", () => {
    const log = { '2026-09-20': 3, '2026-09-21': 1.5, '2026-09-24': 0.5, '2026-09-28': 2 };
    expect(spendThisWeek(log, now)).toBeCloseTo(2);
  });
});

describe('the per-day spend log', () => {
  beforeEach(() => clearSpendLog());

  it('adds days up', () => {
    addToSpendLog('2026-09-24', 0.3);
    addToSpendLog('2026-09-24', 0.12);
    expect(getSpendLog()['2026-09-24']).toBeCloseTo(0.42);
  });

  it('keeps only the last eight days', () => {
    for (let day = 1; day <= 10; day++) addToSpendLog(`2026-09-${String(day).padStart(2, '0')}`, day / 100);
    const log = getSpendLog();
    expect(Object.keys(log).length).toBe(8);
    expect(log['2026-09-01']).toBeUndefined();
    expect(log['2026-09-10']).toBeCloseTo(0.1);
  });

  it("a company's authoritative reading corrects a day, but never lowers it", () => {
    addToSpendLog('2026-09-24', 0.5);
    correctSpendLogDay('2026-09-24', 0.42);
    expect(getSpendLog()['2026-09-24']).toBeCloseTo(0.5);
    correctSpendLogDay('2026-09-24', 0.6);
    expect(getSpendLog()['2026-09-24']).toBeCloseTo(0.6);
  });
});

describe('the weekly limit', () => {
  beforeEach(() => {
    clearSpendLog();
    setDailyLimit(3);
    setWeeklyExtra({ weekStart: '2000-01-06', amount: 0 });
  });

  it('defaults to seven times the daily limit, and can be set', () => {
    expect(getWeeklyLimit()).toBe(21);
    setWeeklyLimit(10);
    expect(getWeeklyLimit()).toBe(10);
    setWeeklyLimit(0); // never accepted: falls back to the default
    expect(getWeeklyLimit()).toBe(21);
  });

  it('the week allowance includes only an extra agreed this week', () => {
    setWeeklyLimit(21);
    setWeeklyExtra({ weekStart: '2020-01-06', amount: 50 });
    expect(spending.allowanceThisWeek(now)).toBe(21);
    setWeeklyExtra({ weekStart: mondayOf(now), amount: 21 });
    expect(spending.allowanceThisWeek(now)).toBe(42);
    setWeeklyExtra({ weekStart: '2020-01-06', amount: 0 });
  });

  it('every reported cost lands in the log, so the week counts across restarts', () => {
    spending.reportSpend(0.3, false, now);
    spending.reportSpend(0.12, true, now);
    expect(spending.spentThisWeek(now)).toBeCloseTo(0.42);
    expect(getSpendLog()[localDate(now)]).toBeCloseTo(0.42);
  });
});

describe('the weekly stop-and-ask', () => {
  beforeEach(() => {
    clearSpendLog();
    session.setDailyLimit(3, 0);
    setDailyExtra({ date: '2000-01-01', amount: 0 });
    setWeeklyExtra({ weekStart: '2000-01-06', amount: 0 });
    session.todaySpend = 0;
    session.transcript = [];
    answer = true;
  });

  it("at the weekly limit asks to allow another week's worth, remembered for this week only", async () => {
    setWeeklyLimit(21);
    setDailyExtra({ date: localDate(now), amount: 100 }); // so the daily limit is out of the way
    spending.reportSpend(21, false, now);
    expect(await spending.withinLimits(now)).toBe(true);
    expect(session.transcript.at(-1)).toMatchObject({ text: "This week's $21.00 spending limit is reached. Allow another $21.00 this week? (y/n)" });
    expect(spending.allowanceThisWeek(now)).toBe(42);
    answer = false;
    expect(await spending.withinLimits(now)).toBe(true); // the extra already granted keeps working
  });

  it('stops on no, and says so through the transcript, not silently', async () => {
    setWeeklyLimit(21);
    setDailyExtra({ date: localDate(now), amount: 100 });
    spending.reportSpend(22, false, now);
    answer = false;
    expect(await spending.withinLimits(now)).toBe(false);
    expect(session.transcript.at(-1)).toMatchObject({ kind: 'notice' });
  });

  it('a week with nothing in it never asks', async () => {
    setWeeklyLimit(21);
    expect(await spending.withinLimits(now)).toBe(true);
    expect(session.transcript).toEqual([]);
  });
});
