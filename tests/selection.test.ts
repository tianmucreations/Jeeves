import { describe, it, expect, afterEach } from 'vitest';
import { session } from '../src/state/session.js';
import { pointAt, selectedText } from '../src/ink/selection.js';
import { parseMouseSequence } from '../src/ink/mouse.js';

const lines = ['> first message   ', '', 'The answer starts here', 'and carries on here.', '✓ Listed files'];

afterEach(() => {
  session.selection = null;
  session.transcriptView = null;
});

describe('selecting text in the conversation (Claude Code: drag, copied on release)', () => {
  it('turns a screen position into a line and character, newest line on the bottom row', () => {
    session.transcriptView = { top: 3, left: 3, height: 10, lines, scrollTop: 0 };
    expect(pointAt(3, 12)).toEqual({ line: 4, ch: 0 });
    expect(pointAt(7, 10)).toEqual({ line: 2, ch: 4 });
    expect(pointAt(3, 5)).toBeNull(); // empty rows above a short conversation
    expect(pointAt(3, 2)).toBeNull(); // the header
  });

  it('follows the view when it is scrolled up', () => {
    const many = Array.from({ length: 30 }, (_, i) => `line ${i}`);
    session.transcriptView = { top: 3, left: 3, height: 10, lines: many, scrollTop: 5 };
    expect(pointAt(3, 12)).toEqual({ line: 24, ch: 0 });
    expect(pointAt(3, 3)).toEqual({ line: 15, ch: 0 });
  });

  it('copies across lines, in reading order whichever way the drag went, without padding', () => {
    session.selection = { anchor: { line: 3, ch: 8 }, focus: { line: 2, ch: 4 } };
    expect(selectedText(lines)).toBe('answer starts here\nand carri');
    session.selection = { anchor: { line: 0, ch: 2 }, focus: { line: 0, ch: 40 } };
    expect(selectedText(lines)).toBe('first message');
  });

  it('reads a drag from the terminal (button code plus 32)', () => {
    expect(parseMouseSequence('\x1b[<32;10;5M')).toEqual({ kind: 'drag', button: 0, col: 10, row: 5 });
    expect(parseMouseSequence('\x1b[<0;10;5m')).toEqual({ kind: 'release', button: 0, col: 10, row: 5 });
  });
});
