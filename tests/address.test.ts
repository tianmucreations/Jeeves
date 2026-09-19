import { describe, it, expect } from 'vitest';
import { cleanAddress, timeOfDayGreeting } from '../src/platform/address.js';

describe('how Jeeves addresses the person', () => {
  it('never guesses: nothing typed is no answer', () => {
    expect(cleanAddress('')).toBeNull();
    expect(cleanAddress('   ')).toBeNull();
    expect(cleanAddress("  Ma'am ")).toBe("Ma'am");
    expect(cleanAddress('Doctor   Smith')).toBe('Doctor Smith');
    expect(cleanAddress('x'.repeat(50))).toHaveLength(30);
  });

  it('greets by the time of day, not always "Good evening"', () => {
    expect(timeOfDayGreeting(new Date(2026, 8, 19, 8))).toBe('Good morning');
    expect(timeOfDayGreeting(new Date(2026, 8, 19, 14))).toBe('Good afternoon');
    expect(timeOfDayGreeting(new Date(2026, 8, 19, 20))).toBe('Good evening');
  });
});
