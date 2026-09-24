// The GLM Coding Plan's own usage figures, read from Z.ai's monitor endpoint -
// the same address maintained open-source usage monitors use (verified against
// opencode-glm-quota's source, MIT, updated Sept 2026) and matching Z.ai's plan
// docs: every plan has a 5-hour limit and a weekly limit, counted in plan
// credits, no matter how many times the app is opened in between (owner, 24
// Sept: this is the "session" he wants shown). The reply carries ready-worked
// percentages, so nothing is estimated or guessed here. Read-only, costs nothing.

export interface ZaiQuota {
  // Share of the 5-hour window and of the week's credits already used, 0-100.
  fiveHourPct: number;
  weeklyPct: number;
  // Local 'HH:MM' when each window resets, when Z.ai says.
  fiveHourResetAt: string | null;
  weeklyResetAt: string | null;
}

export const ZAI_QUOTA_URL = 'https://api.z.ai/api/monitor/usage/quota/limit';

// Pure, so it can be tested against a captured reply. The reply wraps the list
// in "data" (checked live, 24 Sept: {"code":200,"data":{"limits":[...]}}), and
// names the entries CREDIT_LIMIT - the older TOKENS_LIMIT name is accepted too,
// and the 5-hour window is unit 3 number 5, the week unit 6 number 1.
export function parseZaiQuota(payload: unknown, now = new Date()): ZaiQuota | null {
  const body = payload as { data?: { limits?: unknown } | null; limits?: unknown } | null;
  if (body === null || typeof body !== 'object') return null;
  const limits = body.data?.limits ?? body.limits;
  if (!Array.isArray(limits)) return null;
  let fiveHourPct: number | null = null;
  let weeklyPct: number | null = null;
  let fiveHourResetAt: string | null = null;
  let weeklyResetAt: string | null = null;
  for (const limit of limits) {
    if (typeof limit !== 'object' || limit === null) continue;
    const item = limit as Record<string, unknown>;
    if (item.type !== 'CREDIT_LIMIT' && item.type !== 'TOKENS_LIMIT') continue;
    const pct = typeof item.percentage === 'number' && Number.isFinite(item.percentage) ? item.percentage : null;
    if (pct === null) continue;
    if (item.unit === 3 && item.number === 5) {
      fiveHourPct = pct;
      fiveHourResetAt = resetAt(item.nextResetTime, now);
    } else if (item.unit === 6 && item.number === 1) {
      weeklyPct = pct;
      weeklyResetAt = resetAt(item.nextResetTime, now);
    }
  }
  if (fiveHourPct === null && weeklyPct === null) return null;
  return { fiveHourPct: fiveHourPct ?? 0, weeklyPct: weeklyPct ?? 0, fiveHourResetAt, weeklyResetAt };
}

function resetAt(value: unknown, _now: Date): string | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

// The key goes in the Authorization header WITHOUT the "Bearer" word - that is
// how the monitor endpoint wants it (copied from the verified source above).
export async function fetchZaiQuota(apiKey: string): Promise<ZaiQuota | null> {
  try {
    const response = await fetch(ZAI_QUOTA_URL, {
      headers: { Authorization: apiKey, 'Content-Type': 'application/json', 'Accept-Language': 'en-US,en' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    return parseZaiQuota(await response.json());
  } catch {
    return null;
  }
}
