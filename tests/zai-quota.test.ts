import { describe, it, expect } from 'vitest';
import { parseZaiQuota } from '../src/providers/zai-quota.js';

// The plan's own usage figures, parsed from Z.ai's monitor endpoint - the same
// shape the maintained open-source usage monitors read (verified Sept 2026).
describe("the plan's own usage figures", () => {
  const now = new Date(2026, 8, 24, 12, 0, 0);

  it('reads the 5-hour session and the week from the real reply (captured live, 24 Sept)', () => {
    const payload = {
      code: 200,
      msg: 'Operation successful',
      data: {
        limits: [
          { type: 'CREDIT_LIMIT', unit: 3, number: 5, usage: 2000, currentValue: 233, remaining: 1766, percentage: 11, nextResetTime: new Date(2026, 8, 24, 13, 3).getTime() },
          { type: 'CREDIT_LIMIT', unit: 6, number: 1, usage: 10000, currentValue: 2143, remaining: 7856, percentage: 21, nextResetTime: new Date(2026, 8, 28, 9, 0).getTime() },
        ],
        level: 'lite',
      },
      success: true,
    };
    expect(parseZaiQuota(payload, now)).toEqual({ fiveHourPct: 11, weeklyPct: 21, fiveHourResetAt: '13:03', weeklyResetAt: '09:00' });
  });

  it('still reads the older unwrapped shape with the TOKENS_LIMIT name', () => {
    const payload = {
      limits: [
        { type: 'TOKENS_LIMIT', unit: 3, number: 5, percentage: 42.4, total: 12000, nextResetTime: new Date(2026, 8, 24, 13, 3).getTime() },
        { type: 'TOKENS_LIMIT', unit: 6, number: 1, percentage: 13, total: 60000, nextResetTime: new Date(2026, 8, 28, 9, 0).getTime() },
        { type: 'TIME_LIMIT', percentage: 2.5 },
      ],
    };
    expect(parseZaiQuota(payload, now)).toEqual({ fiveHourPct: 42.4, weeklyPct: 13, fiveHourResetAt: '13:03', weeklyResetAt: '09:00' });
  });

  it('carries on when one window is missing, and gives up on anything unexpected', () => {
    const onlySession = parseZaiQuota({ data: { limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5, percentage: 7 }] } });
    expect(onlySession).toEqual({ fiveHourPct: 7, weeklyPct: 0, fiveHourResetAt: null, weeklyResetAt: null });
    expect(parseZaiQuota({})).toBeNull();
    expect(parseZaiQuota(null)).toBeNull();
    expect(parseZaiQuota({ data: { limits: [{ type: 'TIME_LIMIT', percentage: 5 }] } })).toBeNull();
    expect(parseZaiQuota({ data: { limits: [{ type: 'CREDIT_LIMIT', unit: 3, number: 5 }] } })).toBeNull();
    expect(parseZaiQuota({ data: { limits: 'no' } })).toBeNull();
  });
});
