import { session } from '../state/session.js';
import { pointAt, copySelection, wordBoundsAt } from './selection.js';

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

// Whoever is showing on screen listens here. Mouse reports never travel through
// Ink's keyboard events any more (see stdin-filter.ts); they are handed to the
// listeners directly - the conversation's typing box and the Settings list.
const listeners = new Set<(report: string) => void>();
export function subscribeMouse(listener: (report: string) => void): () => void {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}

// A trackpad flick sends dozens of wheel reports a second. They are gathered for
// one frame's time and handled together (one redraw, not dozens) - Claude Code's
// ScrollBox does the same with a microtask-coalesced scrollBy. Anything else
// (a click, a drag) first lets the gathered wheel reports through, then runs.
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

// Wheel up scrolls the transcript up 3 rows, wheel down 3 rows back (or, over a
// long message in the typing box, that message); the session clamps at the newest
// (0) and the Transcript clamps at the oldest. The info bar's Settings button
// opens Settings. A left-button
// press in the conversation starts a selection, dragging extends it, and releasing
// copies it. Nothing here ever reaches the text being typed.
// Double-click selects the word under the pointer and triple-click the whole line,
// copied when the button comes up - as Claude Code (App.tsx: 500 ms, one cell of
// jitter allowed) and every terminal's own selection. Most people "highlight"
// something by double-clicking it, which used to do nothing here (owner, 26 Sept).
const MULTI_CLICK_MS = 500;
const lastClick = { time: 0, col: -1, row: -1, count: 0 };
let multiClickSelection = false;

// Drag past the top or bottom edge of the conversation and it keeps scrolling by
// itself, two rows every 50 ms, extending the selection as it goes - Claude Code's
// useDragToScroll (ScrollKeybindingHandler.tsx: AUTOSCROLL_LINES 2, INTERVAL 50 ms,
// capped at 200 ticks in case the release is lost). Mouse reports only arrive when
// the pointer moves, so a timer carries on while it is held still at the edge.
const AUTOSCROLL_LINES = 2;
const AUTOSCROLL_INTERVAL_MS = 50;
const AUTOSCROLL_MAX_TICKS = 200;
let autoTimer: NodeJS.Timeout | null = null;
let autoTicks = 0;
let autoDir: -1 | 1 | 0 = 0;
let autoAt = { col: 1, row: 1 };
let autoLast = 0;

function stopAutoScroll(): void {
  if (autoTimer) clearInterval(autoTimer);
  autoTimer = null;
  autoDir = 0;
}

function autoScrollTick(): void {
  const current = session.selection;
  if (!current || autoDir === 0 || ++autoTicks > AUTOSCROLL_MAX_TICKS) return stopAutoScroll();
  // While Jeeves is drawing, ticks arrive late; the rows a late tick missed are made
  // up so the speed stays two rows per 50 ms of real time (at most 10 ticks' worth).
  const now = Date.now();
  const due = Math.max(1, Math.min(10, Math.floor((now - autoLast) / AUTOSCROLL_INTERVAL_MS)));
  autoLast = now;
  session.scrollTranscript((autoDir < 0 ? 1 : -1) * AUTOSCROLL_LINES * due);
  const point = pointAt(autoAt.col, autoAt.row, true);
  if (point) session.setSelection({ anchor: current.anchor, focus: point });
}

function updateAutoScroll(row: number): void {
  const view = session.transcriptView;
  if (!view) return stopAutoScroll();
  const want: -1 | 0 | 1 = row < view.top ? -1 : row >= view.top + view.height ? 1 : 0;
  if (want === 0) return stopAutoScroll();
  if (want === autoDir) return;
  stopAutoScroll();
  autoDir = want;
  autoTicks = 0;
  autoLast = Date.now();
  autoTimer = setInterval(autoScrollTick, AUTOSCROLL_INTERVAL_MS);
}

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
    stopAutoScroll();
    const point = pointAt(event.col, event.row);
    const now = Date.now();
    const near = now - lastClick.time < MULTI_CLICK_MS && Math.abs(event.col - lastClick.col) <= 1 && Math.abs(event.row - lastClick.row) <= 1;
    lastClick.count = near ? lastClick.count + 1 : 1;
    Object.assign(lastClick, { time: now, col: event.col, row: event.row });
    multiClickSelection = false;
    const text = point ? session.transcriptView?.lines[point.line] : undefined;
    if (point && text !== undefined && lastClick.count >= 2) {
      const range = lastClick.count === 2 ? wordBoundsAt(text, point.ch) : ([0, Array.from(text).length] as [number, number]);
      if (range) {
        session.setSelection({ anchor: { line: point.line, ch: range[0] }, focus: { line: point.line, ch: Math.max(range[0], range[1] - 1) } });
        multiClickSelection = true;
        return;
      }
    }
    session.setSelection(point ? { anchor: point, focus: point } : null);
    // Outside the conversation: a click answers a pending question if one is on
    // screen, otherwise it places the cursor in the typing box.
    if (!point) {
      if (session.questionClick?.(event.col, event.row)) return;
      if (session.tasksClick?.(event.col, event.row)) return;
      if (session.footerClick?.(event.col, event.row)) return;
      if (session.approvalPending) session.approvalClick?.(event.col, event.row);
      else session.inputClick?.(event.col, event.row);
    }
    return;
  }
  // A word or line picked by double or triple click stays as picked, and is
  // copied when the button comes up.
  if (multiClickSelection) {
    if (event.kind === 'release') {
      multiClickSelection = false;
      void copySelection();
    }
    return;
  }
  const current = session.selection;
  if (!current) return stopAutoScroll();
  const point = pointAt(event.col, event.row, true);
  if (point) session.setSelection({ anchor: current.anchor, focus: point });
  autoAt = { col: event.col, row: event.row };
  if (event.kind === 'drag') updateAutoScroll(event.row);
  else stopAutoScroll();
  if (event.kind === 'release') {
    const moved = point && (point.line !== current.anchor.line || point.ch !== current.anchor.ch);
    if (moved) void copySelection();
    else session.setSelection(null);
  }
}
