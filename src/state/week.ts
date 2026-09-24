// "This week" in the info bar and the weekly spending limit is the calendar week
// starting Monday (the owner is in Australia, where weeks start Monday), in the
// computer's own time zone - like "today", which follows the computer's clock.
import { localDate } from './today-spend.js';

// The date (YYYY-MM-DD) of the Monday of the week containing `now`.
export function mondayOf(now: Date): string {
  const offset = (now.getDay() + 6) % 7; // Monday -> 0, Sunday -> 6
  const monday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - offset);
  return localDate(monday);
}

// The week's total from a per-day log: every day whose Monday is this week's.
export function spendThisWeek(log: Record<string, number>, now: Date): number {
  const monday = mondayOf(now);
  let total = 0;
  for (const [date, amount] of Object.entries(log)) {
    const [year, month, day] = date.split('-').map(Number);
    if (!year || !month || !day) continue;
    if (mondayOf(new Date(year, month - 1, day)) === monday) total += amount;
  }
  return total;
}
