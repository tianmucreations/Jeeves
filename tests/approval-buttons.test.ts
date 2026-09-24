import { describe, it, expect } from 'vitest';
import { approvalButtons, approvalButtonAt } from '../src/ink/approval-buttons.js';

describe('the approval button row', () => {
  it('offers Allow and Don\'t allow when the change cannot be trusted for the project', () => {
    const buttons = approvalButtons(false);
    expect(buttons.map((b) => b.key)).toEqual(['y', 'n']);
  });

  it('adds Always allow in this project when the change can be trusted', () => {
    const buttons = approvalButtons(true);
    expect(buttons.map((b) => b.key)).toEqual(['y', 'a', 'n']);
  });

  it('matches Jeeves Desktop\'s own button labels, so the two feel like one product', () => {
    const buttons = approvalButtons(true);
    expect(buttons.map((b) => b.label)).toEqual(['Allow (y)', 'Always allow in this project (a)', "Don't allow (n)"]);
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

describe('the "always allow this kind of command" button', () => {
  it('is offered on a command question, between Allow and the project answer', () => {
    const buttons = approvalButtons(true, 'wc');
    expect(buttons.map((b) => b.key)).toEqual(['y', 'c', 'a', 'n']);
    expect(buttons[1].label).toBe('Always allow wc');
    expect(buttons[2].label).toBe('Always this project');
  });

  it('names several kinds together when the command has several stages', () => {
    const buttons = approvalButtons(true, 'these commands');
    expect(buttons[1].label).toBe('Always allow these commands');
  });

  it('keeps the row inside 80 columns even with a long kind', () => {
    const buttons = approvalButtons(true, 'docker compose');
    const width = buttons[buttons.length - 1].end;
    expect(width).toBeLessThanOrEqual(76);
  });

  it('a click lands on the kind answer, and the layout has no gaps', () => {
    const buttons = approvalButtons(true, 'wc');
    for (let i = 1; i < buttons.length; i++) {
      expect(buttons[i].start).toBeGreaterThan(buttons[i - 1].end);
    }
    expect(approvalButtonAt(buttons, buttons[1].start)?.key).toBe('c');
    expect(approvalButtonAt(buttons, buttons[1].end - 1)?.key).toBe('c');
    expect(approvalButtonAt(buttons, buttons[2].start)?.key).toBe('a');
    expect(approvalButtonAt(buttons, buttons[3].start)?.key).toBe('n');
  });

  it('without project trust the kind answer is still offered', () => {
    const buttons = approvalButtons(false, 'wc');
    expect(buttons.map((b) => b.key)).toEqual(['y', 'c', 'n']);
  });

  it('without a command the row is exactly as before (he approved those labels)', () => {
    expect(approvalButtons(true).map((b) => b.label)).toEqual(['Allow (y)', 'Always allow in this project (a)', "Don't allow (n)"]);
  });
});
