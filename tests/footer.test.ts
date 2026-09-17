import { describe, it, expect } from 'vitest';
import { shortModelName, footerSegments, fitModelName, type FooterInfo } from '../src/components/Footer.js';
import { localDate, nextSpendReading, spentToday } from '../src/state/today-spend.js';
import { contextLimitFor, shouldAutoSummarise } from '../src/agent/context.js';
import { DEFAULT_CONTEXT_TOKENS } from '../src/state/session.js';
import { plainError } from '../src/agent/errors.js';

const base: FooterInfo = { providerId: 'openrouter', allowance: 3, tidying: false, todaySpend: 0.31, creditRemaining: 12.5, creditIsAccount: true, planResetAt: null };
const texts = (info: FooterInfo) => footerSegments(info).map((segment) => segment.text);

describe('info bar', () => {
  it('shortens model names', () => {
    expect(shortModelName('z-ai/glm-5.3')).toBe('glm-5.3');
    expect(shortModelName('gpt-4o')).toBe('gpt-4o');
  });

  it("shows today's spend and what is left, nothing else, while all is well", () => {
    expect(texts(base)).toEqual(['today $0.31 of $3.00', '$12.50 left']);
    expect(footerSegments(base)[0].color).toBeUndefined();
    expect(footerSegments(base)[1].color).toBeUndefined();
  });

  it('turns the balance amber under $5, and adds "credit low - top up" in red under $1', () => {
    expect(footerSegments({ ...base, creditRemaining: 2.84 })[1].color).toBe('yellow');
    const low = footerSegments({ ...base, creditRemaining: 0.94 });
    expect(low.map((s) => s.text)).toEqual(['today $0.31 of $3.00', '$0.94 left', 'credit low - top up']);
    expect(low[1].color).toBe('red');
    expect(low[2].color).toBe('red');
  });

  it('shows placeholders before the first reading, and labels a key limit as such', () => {
    expect(texts({ ...base, todaySpend: null, creditRemaining: null })).toEqual(['today $— of $3.00', '$— left']);
    expect(texts({ ...base, creditIsAccount: false })).toEqual(['today $0.31 of $3.00', '$12.50 key limit']);
  });

  it('shows the flat-rate plan, and when it is used up, when it resets', () => {
    expect(texts({ ...base, providerId: 'zai' })).toEqual(['flat-rate plan']);
    const used = footerSegments({ ...base, providerId: 'zai', planResetAt: '13:03' });
    expect(used).toEqual([{ text: 'plan used up · resets @ 13:03', color: 'red' }]);
    expect(texts({ ...base, providerId: 'zai', planResetAt: '' })).toEqual(['plan used up']);
  });

  it("warns as today's spend nears the daily limit, and shows tidying up while it happens", () => {
    expect(footerSegments({ ...base, todaySpend: 2.4 })[0]).toEqual({ text: 'today $2.40 of $3.00', color: 'yellow' });
    expect(footerSegments({ ...base, todaySpend: 3.1 })[0]).toEqual({ text: 'today $3.10 of $3.00', color: 'red' });
    expect(texts({ ...base, tidying: true })[0]).toBe('tidying up…');
    expect(texts({ ...base, providerId: 'zai', tidying: true })).toEqual(['tidying up…']);
  });

  it('shows local models as free', () => {
    expect(texts({ ...base, providerId: 'ollama' })).toEqual(['on this computer · free']);
  });

  it('clips the model name before the right side can wrap', () => {
    expect(fitModelName('deepseek-v4-flash-0731', 30)).toBe('deepseek-v4-flash-0731');
    expect(fitModelName('deepseek-v4-flash-0731', 10)).toBe('deepseek-…');
  });

  it("carries the reset time from Z.ai's real limit message", () => {
    const raw = 'Failed after 3 attempts. Last error: AI_APICallError: Usage limit reached for 5 hour. Your limit will reset at 2026-09-17 13:03:01';
    expect(plainError(new Error(raw), 'zai').resetAt).toBe('13:03');
    expect(plainError(new Error('401 Unauthorized'), 'zai').resetAt).toBeUndefined();
  });
});

describe("today's spend in the user's own calendar day", () => {
  const at = (y: number, m: number, d: number, h: number) => new Date(y, m - 1, d, h, 0, 0);

  it('uses the local date, not UTC', () => {
    expect(localDate(at(2026, 9, 17, 0))).toBe('2026-09-17');
    expect(localDate(at(2026, 9, 17, 23))).toBe('2026-09-17');
  });

  it('counts from the first reading, and accumulates through the day', () => {
    let reading = nextSpendReading(undefined, 82.1, at(2026, 9, 17, 9));
    expect(spentToday(reading)).toBe(0);
    reading = nextSpendReading(reading, 82.35, at(2026, 9, 17, 15));
    expect(spentToday(reading)).toBeCloseTo(0.25);
  });

  it("starts a new day from yesterday's last reading", () => {
    const yesterday = { date: '2026-09-17', baseline: 80, last: 82.35 };
    const reading = nextSpendReading(yesterday, 82.5, at(2026, 9, 18, 8));
    expect(reading.date).toBe('2026-09-18');
    expect(spentToday(reading)).toBeCloseTo(0.15);
  });

  it('never carries a stale reading across several days, or a lower number from a new key', () => {
    const old = { date: '2026-09-10', baseline: 70, last: 75 };
    expect(spentToday(nextSpendReading(old, 82.5, at(2026, 9, 18, 8)))).toBe(0);
    const today = { date: '2026-09-18', baseline: 80, last: 82 };
    expect(spentToday(nextSpendReading(today, 1.2, at(2026, 9, 18, 9)))).toBe(0);
  });
});

describe('automatic summarising', () => {
  it("uses the model's own memory size, from either model list", () => {
    expect(contextLimitFor('some/model', [{ id: 'some/model', contextLength: 200_000 }])).toBe(200_000);
    expect(contextLimitFor('glm-5.3', [])).toBe(200_000);
    expect(contextLimitFor('unknown/model', [])).toBe(DEFAULT_CONTEXT_TOKENS);
  });

  it("summarises at Anthropic's 100,000-token point, or 70% of a smaller memory", () => {
    expect(shouldAutoSummarise(99_999, 1_310_720)).toBe(false);
    expect(shouldAutoSummarise(100_000, 1_310_720)).toBe(true);
    expect(shouldAutoSummarise(69_999, 100_000)).toBe(false);
    expect(shouldAutoSummarise(70_000, 100_000)).toBe(true);
  });
});

describe('chat-only models', () => {
  it('tell Jeeves plainly that he cannot do tasks', async () => {
    const { CHAT_ONLY_NOTE } = await import('../src/agent/loop.js');
    expect(CHAT_ONLY_NOTE).toContain('can only chat');
    expect(CHAT_ONLY_NOTE).toContain('suggest typing /model');
    expect(CHAT_ONLY_NOTE).toContain('Never pretend to have done it.');
  });
});
