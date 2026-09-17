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

  it('recognises but ignores presses and releases', () => {
    expect(parseMouseSequence('\x1b[<0;5;5M')?.kind).toBe('press');
    expect(parseMouseSequence('\x1b[<0;5;5m')?.kind).toBe('release');
    expect(parseMouseSequence('\x1b[<32;5;5M')).toBeNull();
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
