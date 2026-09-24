import { describe, it, expect } from 'vitest';
import { approvalButtons, approvalButtonAt } from '../src/ink/approval-buttons.js';

describe('the approval button row', () => {
  it('offers Allow and Decline when the change cannot be trusted for the project', () => {
    const buttons = approvalButtons(false);
    expect(buttons.map((b) => b.key)).toEqual(['y', 'n']);
  });

  it('adds Always Allow when the change can be trusted', () => {
    const buttons = approvalButtons(true);
    expect(buttons.map((b) => b.key)).toEqual(['y', 'a', 'n']);
  });

  it('reads exactly as the owner specified: Allow, Always Allow, Decline (24 Sept)', () => {
    const buttons = approvalButtons(true);
    expect(buttons.map((b) => b.label)).toEqual(['Allow', 'Always Allow', 'Decline']);
    expect(approvalButtons(false).map((b) => b.label)).toEqual(['Allow', 'Decline']);
  });

  it('lays buttons out left to right with no gaps or overlaps', () => {
    const buttons = approvalButtons(true);
    for (let i = 1; i < buttons.length; i++) {
      expect(buttons[i].start).toBeGreaterThan(buttons[i - 1].end);
    }
    expect(buttons[0].start).toBe(0);
  });

  it('finds the button a click landed on, by column', () => {
    const buttons = approvalButtons(true);
    expect(approvalButtonAt(buttons, 0)?.key).toBe('y');
    expect(approvalButtonAt(buttons, buttons[0].end - 1)?.key).toBe('y');
    expect(approvalButtonAt(buttons, buttons[1].start)?.key).toBe('a');
    expect(approvalButtonAt(buttons, buttons[2].start)?.key).toBe('n');
  });

  it('a click in the gap between buttons hits nothing', () => {
    const buttons = approvalButtons(true);
    expect(approvalButtonAt(buttons, buttons[0].end)).toBeNull();
  });
  it('a click before the first button or past the last hits nothing', () => {
    const buttons = approvalButtons(false);
    expect(approvalButtonAt(buttons, -1)).toBeNull();
    expect(approvalButtonAt(buttons, buttons[buttons.length - 1].end)).toBeNull();
  });
});
