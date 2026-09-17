import { session } from '../state/session.js';

// SGR mouse tracking (modes 1000 + 1002 + 1006), enabled for the whole session by
// the AlternateScreen takeover and disabled on every exit path. Claude Code's
// approach: in the alternate screen the terminal has no scrollback, so wheel
// events are captured and translated into transcript scrolling. The trade-off is
// native click-drag selection; Shift (or Option in Terminal.app) bypasses mouse
// capture for copying - the help screen says so.
export const ENABLE_MOUSE_TRACKING = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
export const DISABLE_MOUSE_TRACKING = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

// Ink's input parser hands over complete CSI sequences but strips the leading ESC
// from ones it cannot resolve, so both forms are accepted here.
const MOUSE_RE = /^\x1b?\[<(\d+);(\d+);(\d+)([Mm])$/;

export type MouseKind = 'press' | 'release' | 'wheel';

export interface ParsedMouseEvent {
  kind: MouseKind;
  button: number;
  col: number;
  row: number;
}

export function isMouseSequence(input: string): boolean {
  return MOUSE_RE.test(input);
}

// SGR mouse protocol: press ends in M, release ends in m; 64 is wheel up and 65
// is wheel down, arriving as single events with no press/release distinction.
// Everything else (clicks, drags) is parsed for recognition but not acted on.
export function parseMouseSequence(input: string): ParsedMouseEvent | null {
  const match = MOUSE_RE.exec(input);
  if (!match) return null;
  const rawButton = Number(match[1]);
  const col = Number(match[2]);
  const row = Number(match[3]);
  const final = match[4];
  if (final === 'm') {
    if (rawButton > 3) return null;
    return { kind: 'release', button: rawButton, col, row };
  }
  if (rawButton === 64 || rawButton === 65) {
    return { kind: 'wheel', button: rawButton - 64, col, row };
  }
  if (rawButton <= 6) {
    return { kind: 'press', button: rawButton, col, row };
  }
  return null;
}

// Wheel up scrolls the transcript up 3 rows, wheel down 3 rows back; the session
// clamps at the newest (0) and the Transcript clamps at the oldest. Non-wheel
// events are consumed silently - clicks must never leak into text inputs.
export function handleMouseInput(input: string): void {
  const event = parseMouseSequence(input);
  if (event === null || event.kind !== 'wheel') return;
  session.scrollTranscript(event.button === 0 ? 3 : -3);
}
