import { describe, it, expect } from 'vitest';
import { isMouseSequence, parseMouseSequence, handleMouseInput } from '../src/ink/mouse.js';
import { session } from '../src/state/session.js';

describe('SGR mouse parsing', () => {
  it('recognises wheel events with or without the leading escape', () => {
    expect(isMouseSequence('\x1b[<64;10;10M')).toBe(true);
    expect(isMouseSequence('[<65;30;5M')).toBe(true);
    expect(isMouseSequence('a')).toBe(false);
    expect(isMouseSequence('\x1b[A')).toBe(false);
  });

  it('parses wheel up as button 0 and wheel down as button 1', () => {
    const up = parseMouseSequence('\x1b[<64;10;10M');
    expect(up).toEqual({ kind: 'wheel', button: 0, col: 10, row: 10 });
    const down = parseMouseSequence('\x1b[<65;3;2M');
    expect(down).toEqual({ kind: 'wheel', button: 1, col: 3, row: 2 });
  });

  it('recognises presses, drags (for selecting) and releases', () => {
    expect(parseMouseSequence('\x1b[<0;5;5M')?.kind).toBe('press');
    expect(parseMouseSequence('\x1b[<0;5;5m')?.kind).toBe('release');
    expect(parseMouseSequence('\x1b[<32;5;5M')?.kind).toBe('drag');
    expect(parseMouseSequence('\x1b[<35;5;5M')).toBeNull();
  });

  it('wheel events scroll the transcript three rows at a time, clamped at the newest', () => {
    session.transcriptScrollUp = 0;
    handleMouseInput('\x1b[<64;1;1M');
    expect(session.transcriptScrollUp).toBe(3);
    handleMouseInput('[<64;1;1M');
    expect(session.transcriptScrollUp).toBe(6);
    handleMouseInput('\x1b[<65;1;1M');
    expect(session.transcriptScrollUp).toBe(3);
    handleMouseInput('\x1b[<65;1;1M');
    handleMouseInput('\x1b[<65;1;1M');
    expect(session.transcriptScrollUp).toBe(0);
  });

  it('non-wheel events never scroll', () => {
    session.transcriptScrollUp = 0;
    handleMouseInput('\x1b[<0;1;1M');
    handleMouseInput('\x1b[<0;1;1m');
    expect(session.transcriptScrollUp).toBe(0);
  });
});

describe('scroll clamping', () => {
  it('wheel and keys never scroll past the oldest line', () => {
    session.transcriptScrollUp = 0;
    session.setTranscriptScrollMax(5);
    handleMouseInput('\x1b[<64;1;1M');
    handleMouseInput('\x1b[<64;1;1M');
    handleMouseInput('\x1b[<64;1;1M');
    expect(session.transcriptScrollUp).toBe(5);
    handleMouseInput('\x1b[<65;1;1M');
    expect(session.transcriptScrollUp).toBe(2);
    session.setTranscriptScrollMax(1);
    expect(session.transcriptScrollUp).toBe(1);
    session.setTranscriptScrollMax(Number.POSITIVE_INFINITY);
    session.transcriptScrollUp = 0;
  });
});

describe('double and triple click (26 Sept: "I just highlight it" - Claude Code copies a word or line)', () => {
  const setView = () => {
    session.transcriptView = { top: 3, left: 3, height: 5, lines: ['Hello wonderful world.', 'second line here'], gutters: [0, 0], scrollTop: 0 };
  };
  // Column/row are 1-based; the newest line sits on the bottom row of the view (row 3 + 4 = 7).
  const press = (col: number, row: number) => handleMouseInput(`\x1b[<0;${col};${row}M`);

  it('picks the word under the pointer on the second quick click, without copying until release', async () => {
    const { wordBoundsAt } = await import('../src/ink/selection.js');
    expect(wordBoundsAt('Hello wonderful world.', 8)).toEqual([6, 15]);
    expect(wordBoundsAt('Hello wonderful world.', 3)).toEqual([0, 5]);
    expect(wordBoundsAt('see ~/Documents/x.txt now', 6)).toEqual([4, 21]);
    expect(wordBoundsAt('a  b', 1)).toBeNull();
    setView();
    session.setSelection(null);
    press(20, 6);
    press(20, 6);
    // Row 6 is the first of the two lines (bottom row 7 is the second); col 20 = char 17 of line 0: "world".
    expect(session.selection).toEqual({ anchor: { line: 0, ch: 16 }, focus: { line: 0, ch: 21 } });  // the full stop counts as part of the word, as in Claude Code
  });

  it('picks the whole line on the third quick click', () => {
    setView();
    session.setSelection(null);
    press(10, 7);
    press(10, 7);
    press(10, 7);
    expect(session.selection).toEqual({ anchor: { line: 1, ch: 0 }, focus: { line: 1, ch: 15 } });
  });
});
