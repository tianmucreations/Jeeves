import { describe, it, expect } from 'vitest';
import { endsMidIntention } from '../src/agent/loop.js';

describe('catching a reply that trails off mid-task', () => {
  it('catches the exact reply from the "No Summary or Explanation" screenshot (22 Sept)', () => {
    expect(
      endsMidIntention(
        'The original is back, verified byte-for-byte against the backup. Now let me read the true file in full so my edit keeps everything else exactly as it was.'
      )
    ).toBe(true);
  });

  it('catches every forbidden opener the rulebook names', () => {
    expect(endsMidIntention("I've backed up the folder. Let me check the other file.")).toBe(true);
    expect(endsMidIntention("The file is read. I'll fix the typo next.")).toBe(true);
    expect(endsMidIntention('The file is read. I will fix the typo next.')).toBe(true);
    expect(endsMidIntention("That's done. I'm going to run the tests now.")).toBe(true);
    expect(endsMidIntention('That is done. First, I will check the other folder.')).toBe(true);
    expect(endsMidIntention('That is done. Next, I will check the other folder.')).toBe(true);
  });

  it('does not flag a reply that actually finished', () => {
    expect(endsMidIntention('The letter is saved as letter.txt, with your address and the date you gave me.')).toBe(false);
  });

  it('does not flag an ordinary answer with no task at all', () => {
    expect(endsMidIntention('Good afternoon, Sir. How may I help?')).toBe(false);
  });

  it('does not flag "let me know" - an ordinary closing courtesy, not a dangling action', () => {
    expect(endsMidIntention('The report is saved to summary.txt. Let me know if you would like anything changed.')).toBe(false);
  });

  it('only judges the last sentence, not an earlier one that happens to start the same way', () => {
    expect(endsMidIntention("Let me check that folder first. Yes - it's empty, so nothing more to do.")).toBe(false);
  });

  it('treats an empty or whitespace-only reply as not mid-intention (nothing to continue)', () => {
    expect(endsMidIntention('')).toBe(false);
    expect(endsMidIntention('   ')).toBe(false);
  });
});
