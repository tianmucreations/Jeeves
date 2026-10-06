import { session } from '../state/session.js';

// SGR mouse tracking (modes 1000 + 1002 + 1006). Since the move to the
// terminal's own scrollback (3 Oct), the plain conversation deliberately has
// mouse reporting OFF: the wheel, the scrollbar and click-drag selection belong
// to the TERMINAL, exactly as in Claude Code - scroll back any time, even
// mid-answer, and select + copy natively. The app turns mouse reporting on
// only where there is something of ours to click: a question, the Allow
// buttons, or a screen with lists and buttons. This module parses those
// reports and routes the clicks.
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

// Whoever is showing on screen listens here. Mouse reports never travel through
// Ink's keyboard events (see stdin-filter.ts); they are handed to the listeners
// directly - the typing box and the screens with lists.
const listeners = new Set<(report: string) => void>();
export function subscribeMouse(listener: (report: string) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// A trackpad flick sends dozens of wheel reports a second. They are gathered for
// one frame's time and handled together (one redraw, not dozens) - the same
// coalescing Claude Code applies to its own scrolls. Anything else (a click, a
// drag) first lets the gathered wheel reports through, then runs.
const WHEEL_BATCH_MS = 16;
let wheelQueue: string[] = [];
let wheelTimer: NodeJS.Timeout | null = null;

function flushWheel(): void {
  if (wheelTimer) clearTimeout(wheelTimer);
  wheelTimer = null;
  const queued = wheelQueue;
  wheelQueue = [];
  for (const report of queued) for (const listener of [...listeners]) listener(report);
}

export function dispatchMouse(report: string): void {
  const event = parseMouseSequence(report);
  if (event?.kind === 'wheel') {
    wheelQueue.push(report);
    if (!wheelTimer) wheelTimer = setTimeout(flushWheel, WHEEL_BATCH_MS);
    return;
  }
  flushWheel();
  for (const listener of [...listeners]) listener(report);
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

// Where clicks land, in priority order: a question's choices, the info bar's
// buttons, the Allow buttons, then the typing box. The wheel over the typing
// box reads back through a message taller than the box; everywhere else a
// wheel event has nothing of ours to move (the terminal scrolls itself), so
// it is ignored.
// THE HAND-OFF (6 Oct). The buttons in the info bar need mouse reports, but with
// reporting on the terminal sends the wheel and drags to us instead of scrolling
// its own history or selecting. So the mouse is ours only until the person
// reaches for the terminal's own abilities: a turn of the wheel, or a click in
// the printed history above the live block. Then reporting goes off for a few
// seconds (the terminal scrolls and selects natively, Cmd+C copies) and comes
// back by itself, so the buttons work again. The one report that triggers it is
// spent; everything after it is the terminal's.
const HAND_OFF_MS = 4000;
let handOffTimer: NodeJS.Timeout | null = null;
let restoreMouse: (() => void) | null = null;
export function setMouseRestore(restore: (() => void) | null): void {
  restoreMouse = restore;
}
export function mouseHandedOff(): boolean {
  return handOffTimer !== null;
}
// A new screen with buttons of its own gets the mouse back at once.
export function endHandOff(): void {
  if (!handOffTimer) return;
  clearTimeout(handOffTimer);
  handOffTimer = null;
  restoreMouse?.();
}
export function handOffToTerminal(ms = HAND_OFF_MS): void {
  try {
    process.stdout.write(DISABLE_MOUSE_TRACKING);
  } catch {
    // A closed stream must never crash the app.
  }
  if (handOffTimer) clearTimeout(handOffTimer);
  handOffTimer = setTimeout(() => {
    handOffTimer = null;
    restoreMouse?.();
  }, ms);
  handOffTimer.unref?.();
}

export function handleMouseInput(input: string): void {
  const event = parseMouseSequence(input);
  if (event === null) return;
  if (event.kind === 'wheel') {
    if (session.inputWheel?.(event.row, event.button === 0) === true) return;
    // Anywhere else: the terminal's own scrolling takes over.
    handOffToTerminal();
    return;
  }
  if (event.button !== 0) return;
  if (event.kind === 'press' && session.blockTop > 0 && event.row < session.blockTop) {
    handOffToTerminal();
    return;
  }
  if (event.kind === 'press') {
    if (session.questionClick?.(event.col, event.row)) return;
    if (session.tasksClick?.(event.col, event.row)) return;
    if (session.footerClick?.(event.col, event.row)) return;
    if (session.approvalPending) {
      session.approvalClick?.(event.col, event.row);
      return;
    }
    session.inputClick?.(event.col, event.row);
  }
}
