// How Jeeves addresses the person. Asked before anything else, in the terminal and
// the window alike, so Jeeves never has to guess "Sir" (owner's request, 19 Sept).

export const ADDRESS_MAX = 30;

// Morning / afternoon / evening by this computer's own clock.
export function partOfDay(now = new Date()): 'morning' | 'afternoon' | 'evening' {
  const hour = now.getHours();
  return hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
}

export function timeOfDayGreeting(now = new Date()): string {
  return `Good ${partOfDay(now)}`;
}

// The address as saved: trimmed and short; null when nothing usable was given.
export function cleanAddress(raw: string): string | null {
  const value = raw.replace(/\s+/g, ' ').trim().slice(0, ADDRESS_MAX);
  return value ? value : null;
}
