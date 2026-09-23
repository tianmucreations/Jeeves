import { session } from '../state/session.js';
import { pointAt, copySelection } from './selection.js';

// SGR mouse tracking (modes 1000 + 1002 + 1006), enabled for the whole session by
// the AlternateScreen takeover and disabled on every exit path. Claude Code's
// approach: in the alternate screen the terminal has no scrollback, so wheel
// events are captured and translated into transcript scrolling. The trade-off is
// the terminal's own click-drag selection, so selection is done here instead
// (selection.ts): drag to select, copied on release. Fn in Terminal.app still
// bypasses capture for the terminal's own selection.
export const ENABLE_MOUSE_TRACKING = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
export const DISABLE_MOUSE_TRACKING = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

// Ink's input parser hands over complete CSI sequences but strips the leading ESC
// from ones it cannot resolve, so both forms are accepted here.
const MOUSE_RE = /^\x1b?\[<(\d+);(\d+);(\d+)([Mm])$/;

export type MouseKind = 'press' | 'drag' | 'release' | 'wheel';

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
  // Mode 1002 reports movement with a button held as the button code plus 32.
  if (rawButton >= 32 && rawButton <= 34) {
    return { kind: 'drag', button: rawButton - 32, col, row };
  }
  return null;
}

// Wheel up scrolls the transcript up 3 rows, wheel down 3 rows back (or, over a
// long message in the typing box, that message); the session clamps at the newest
// (0) and the Transcript clamps at the oldest. The info bar's Settings button
// opens Settings. A left-button
// press in the conversation starts a selection, dragging extends it, and releasing
// copies it. Nothing here ever reaches the text being typed.
export function handleMouseInput(input: string): void {
  const event = parseMouseSequence(input);
  if (event === null) return;
  if (event.kind === 'wheel') {
    // Over a message taller than the typing box, the wheel reads back through it
    // (owner, 23 Sept: only the keys did it); everywhere else it scrolls the conversation.
    if (session.inputWheel?.(event.row, event.button === 0)) return;
    session.scrollTranscript(event.button === 0 ? 3 : -3);
    return;
  }
  if (event.button !== 0) return;
  if (event.kind === 'press') {
    const point = pointAt(event.col, event.row);
    session.setSelection(point ? { anchor: point, focus: point } : null);
    // Outside the conversation: a click answers a pending question if one is on
    // screen, otherwise it places the cursor in the typing box.
    if (!point) {
      if (session.footerClick?.(event.col, event.row)) return;
      if (session.approvalPending) session.approvalClick?.(event.col, event.row);
      else session.inputClick?.(event.col, event.row);
    }
    return;
  }
  const current = session.selection;
  if (!current) return;
  const point = pointAt(event.col, event.row, true);
  if (point) session.setSelection({ anchor: current.anchor, focus: point });
  if (event.kind === 'release') {
    const moved = point && (point.line !== current.anchor.line || point.ch !== current.anchor.ch);
    if (moved) void copySelection();
    else session.setSelection(null);
  }
}
