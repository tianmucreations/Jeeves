// "today" in the info bar is the user's own calendar day, not OpenRouter's. OpenRouter
// reports usage_daily for the current UTC day (openrouter.ai/docs, GET /api/v1/key),
// which for someone at UTC+7 would reset at 7am. Instead the key's all-time usage is
// read after each turn and today's spend is measured from a baseline for the local
// date. The zone is never stored: the date comes from the computer's clock each time,
// so it follows the user when they travel.

export interface SpendReading {
  date: string; // local calendar date, YYYY-MM-DD
  baseline: number; // all-time usage when today began (as best known)
  last: number; // most recent all-time usage reading
}

export function localDate(now: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// When a new day starts, the last reading from yesterday becomes today's baseline,
// so anything spent after that reading counts towards today - it may over-count a
// little, never under-count. A reading older than yesterday is too stale to use.
export function nextSpendReading(prev: SpendReading | undefined, usage: number, now: Date): SpendReading {
  const today = localDate(now);
  if (!prev || usage < prev.last) return { date: today, baseline: usage, last: usage };
  if (prev.date === today) return { ...prev, last: usage };
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
  const baseline = prev.date === localDate(yesterday) ? prev.last : usage;
  return { date: today, baseline, last: usage };
}

export function spentToday(reading: SpendReading): number {
  return Math.max(0, reading.last - reading.baseline);
}
