import { describe, it, expect, beforeEach } from 'vitest';
import {
  isMouseSequence,
  parseMouseSequence,
  registerTranscriptView,
  handleMouseInput,
  copyToClipboard,
} from '../src/ink/mouse.js';
import { session } from '../src/state/session.js';

describe('SGR mouse sequence parsing', () => {
  it('recognises mouse sequences with or without the leading escape', () => {
    expect(isMouseSequence('\x1b[<0;10;5M')).toBe(true);
    expect(isMouseSequence('[<0;10;5M')).toBe(true);
    expect(isMouseSequence('[<0;10;5m')).toBe(true);
    expect(isMouseSequence('hello')).toBe(false);
    expect(isMouseSequence('\x1b[A')).toBe(false);
  });

  it('classifies press, drag, release, and wheel events', () => {
    expect(parseMouseSequence('[<0;10;5M')).toEqual({ kind: 'press', button: 0, col: 10, row: 5 });
    expect(parseMouseSequence('[<32;12;6M')).toEqual({ kind: 'drag', button: 0, col: 12, row: 6 });
    expect(parseMouseSequence('[<0;14;6m')).toEqual({ kind: 'release', button: 0, col: 14, row: 6 });
    expect(parseMouseSequence('[<64;5;5M')).toEqual({ kind: 'wheel', button: 0, col: 5, row: 5 });
    // Shift-modified press is treated as a normal press.
    expect(parseMouseSequence('[<4;10;5M')).toEqual({ kind: 'press', button: 0, col: 10, row: 5 });
    // Middle and right clicks are classified but ignored by the selection machine.
    expect(parseMouseSequence('[<1;10;5M')).toEqual({ kind: 'press', button: 1, col: 10, row: 5 });
    expect(parseMouseSequence('[<2;10;5M')).toEqual({ kind: 'press', button: 2, col: 10, row: 5 });
  });

  it('wheel events scroll the transcript instead of selecting', () => {
    const before = session.transcriptScrollUp;
    handleMouseInput('[<64;5;5M');
    expect(session.transcriptScrollUp).toBe(Math.max(0, before + 3));
    handleMouseInput('[<65;5;5M');
    expect(session.transcriptScrollUp).toBe(Math.max(0, before));
  });
});

describe('drag selection', () => {
  beforeEach(() => {
    session.setSelection(null);
    // Three rendered rows starting at screen row 5; row 0 is the position
    // indicator (non-selectable), rows 1-2 are "hello world" and "second line".
    registerTranscriptView([null, 'hello world', 'second line'], 5);
  });

  it('press, drag, and release builds a selection and copies the text', () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      // Press on the 'h' of hello (screen col 3 = char 0 of row 1).
      handleMouseInput('[<0;3;6M');
      // Drag along the first word and release at the 'o' (char 4, screen col 7).
      handleMouseInput('[<32;5;6M');
      handleMouseInput('[<32;7;6M');
      handleMouseInput('[<0;7;6m');
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(session.selection).toEqual({ startLine: 1, startCol: 0, endLine: 1, endCol: 4 });
    // OSC 52 with the ST terminator, base64 of "hello".
    const osc = writes.find((w) => w.includes('52;c;'));
    expect(osc).toContain('\x1b]52;c;aGVsbG8=\x1b\\');
    // The brief confirmation lands in the transcript.
    expect(session.transcript.some((entry) => entry.kind === 'notice' && entry.text === 'Copied to clipboard')).toBe(true);
    session.transcript = [];
  });

  it('selection spanning rows copies whole lines joined by newlines', () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      handleMouseInput('[<0;3;6M');
      handleMouseInput('[<32;3;7M');
      handleMouseInput('[<0;8;7m');
    } finally {
      process.stdout.write = originalWrite;
    }
    const osc = writes.find((w) => w.includes('52;c;'));
    const payload = osc?.match(/52;c;([A-Za-z0-9+/=]+)/)?.[1] ?? '';
    expect(Buffer.from(payload, 'base64').toString('utf8')).toBe('hello world\nsecond');
    session.transcript = [];
  });

  it('a press outside the transcript clears any selection', () => {
    handleMouseInput('[<0;5;6M');
    expect(session.selection).not.toBeNull();
    handleMouseInput('[<0;5;20M');
    expect(session.selection).toBeNull();
    session.transcript = [];
  });
});

describe('OSC 52 clipboard write', () => {
  it('writes nothing for empty text', () => {
    const writes: string[] = [];
    const originalWrite = process.stdout.write.bind(process.stdout);
    process.stdout.write = ((chunk: unknown) => {
      writes.push(String(chunk));
      return true;
    }) as typeof process.stdout.write;
    try {
      copyToClipboard('');
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(writes).toEqual([]);
  });

  it('lands the text on the real Mac clipboard (pbcopy fallback for Terminal.app)', async () => {
    if (process.platform !== 'darwin') return;
    const { execa } = await import('execa');
    await execa('pbcopy', { input: 'CLIPBOARD_SENTINEL_ZZZ' });
    copyToClipboard('MOUSE_FALLBACK_TEST_9271');
    await new Promise((resolve) => setTimeout(resolve, 500));
    const pasted = await execa('pbpaste');
    expect(pasted.stdout).toBe('MOUSE_FALLBACK_TEST_9271');
  });
});
