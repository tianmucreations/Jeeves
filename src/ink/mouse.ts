import { execa } from 'execa';
import { session } from '../state/session.js';
import { getCopyOnSelect } from '../platform/config.js';
import { contentColumn, transcriptTopRow } from './cursor.js';

// Copy on select, matching OpenCode's behaviour: drag to select, release, and the
// selection lands on the clipboard via OSC 52 (their PR #9008 found the ST
// terminator more reliable than BEL). Mouse reporting is enabled for the whole
// session by the AlternateScreen takeover and disabled on every exit path.

export const ENABLE_MOUSE_TRACKING = '\x1b[?1000h\x1b[?1002h\x1b[?1006h';
export const DISABLE_MOUSE_TRACKING = '\x1b[?1006l\x1b[?1002l\x1b[?1000l';

export function isCopyOnSelectEnabled(): boolean {
  if (process.env.JEEVES_DISABLE_COPY_ON_SELECT === '1') return false;
  return getCopyOnSelect();
}

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

// SGR mouse protocol: press/drag end in M, release ends in m. Button code 32-34 is
// a drag of button 0-2, 64/65 are the wheel, and 4-6 is a shift-modified press.
// Shift-modified presses are treated as normal presses so a selection works either
// way; anything else (middle/right clicks, wheel) is reported for the caller to ignore.
export function parseMouseSequence(input: string): ParsedMouseEvent | null {
  const match = MOUSE_RE.exec(input);
  if (!match) return null;
  const rawButton = Number(match[1]);
  const col = Number(match[2]);
  const row = Number(match[3]);
  const final = match[4];
  const button = rawButton % 4;
  if (final === 'm') {
    if (rawButton > 3) return null;
    return { kind: 'release', button, col, row };
  }
  if (rawButton >= 64 && rawButton <= 65) {
    return { kind: 'wheel', button: rawButton - 64, col, row };
  }
  if (rawButton >= 32 && rawButton <= 38) {
    return { kind: 'drag', button, col, row };
  }
  if (rawButton <= 6) {
    return { kind: 'press', button, col, row };
  }
  return null;
}

// The transcript registers its rendered rows every render so the mouse layer can
// map screen coordinates to text. Null rows are non-selectable UI lines.
interface TranscriptView {
  rows: (string | null)[];
  firstRow: number;
}

let transcriptView: TranscriptView | null = null;

export function registerTranscriptView(rows: (string | null)[], firstRow: number): void {
  transcriptView = { rows, firstRow };
}

interface Cell {
  line: number;
  col: number;
}

function screenToCell(col: number, row: number): Cell | null {
  const view = transcriptView;
  if (!view) return null;
  const index = row - view.firstRow;
  if (index < 0 || index >= view.rows.length) return null;
  const text = view.rows[index];
  if (text === null) return null;
  const charCol = Math.max(0, Math.min(text.length, col - contentColumn()));
  return { line: index, col: charCol };
}

function normalize(a: Cell, b: Cell): { start: Cell; end: Cell } {
  if (a.line < b.line || (a.line === b.line && a.col <= b.col)) return { start: a, end: b };
  return { start: b, end: a };
}

function extractText(start: Cell, end: Cell): string {
  const view = transcriptView;
  if (!view) return '';
  const { start: s, end: e } = normalize(start, end);
  const lines: string[] = [];
  for (let line = s.line; line <= e.line; line++) {
    const text = view.rows[line];
    if (text === null) continue;
    const from = line === s.line ? s.col : 0;
    const to = line === e.line ? e.col + 1 : text.length;
    lines.push(text.slice(from, to).trimEnd());
  }
  return lines.join('\n').trim();
}

// tmux intercepts OSC sequences; the passthrough wraps them in a DCS block with
// every ESC doubled so the inner terminal sees the original sequence. Assumption:
// a single doubling level is correct even for nested sessions, because each tmux
// server unwraps exactly one level on the way in.
function wrapTmux(sequence: string): string {
  if (!process.env.TMUX) return sequence;
  return `\x1bPtmux;${sequence.replace(/\x1b/g, '\x1b\x1b')}\x1b\\`;
}

export function copyToClipboard(text: string): void {
  if (text.length === 0) return;
  const payload = Buffer.from(text, 'utf8').toString('base64');
  try {
    process.stdout.write(wrapTmux(`\x1b]52;c;${payload}\x1b\\`));
  } catch {
    // Clipboard writes are best-effort and must never crash the app.
  }
  // Measured on this machine: macOS Terminal.app ignores OSC 52 entirely, so the
  // selection would silently never reach the clipboard. The system clipboard tool
  // writes it directly when running locally on the Mac; inside tmux OSC 52 is the
  // correct route instead, because it reaches the outer terminal (which may be a
  // different, OSC 52-capable one, possibly over SSH).
  if (process.platform === 'darwin' && !process.env.TMUX) {
    void execa('pbcopy', { input: text }).catch(() => {
      // Best-effort only.
    });
  }
}

// The drag state machine: press starts a selection, drags extend it, release copies
// it and shows a brief confirmation. The highlight stays until the next press.
let dragging = false;
let dragStart: Cell | null = null;

export function handleMouseInput(input: string): void {
  const event = parseMouseSequence(input);
  if (!event) return;
  if (event.kind === 'wheel') {
    // The wheel scrolls the transcript like the arrow keys do; with mouse reporting
    // on, Terminal no longer scrolls itself.
    if (event.button === 0) session.scrollTranscript(3);
    else if (event.button === 1) session.scrollTranscript(-3);
    return;
  }
  if (event.button !== 0) return;
  if (event.kind === 'press') {
    const cell = screenToCell(event.col, event.row);
    dragging = cell !== null;
    dragStart = cell;
    if (cell) {
      session.setSelection({ startLine: cell.line, startCol: cell.col, endLine: cell.line, endCol: cell.col });
    } else {
      session.setSelection(null);
    }
    return;
  }
  if (!dragging || !dragStart) return;
  if (event.kind === 'drag') {
    const cell = screenToCell(event.col, event.row);
    if (cell) {
      session.setSelection({
        startLine: dragStart.line,
        startCol: dragStart.col,
        endLine: cell.line,
        endCol: cell.col,
      });
    }
    return;
  }
  if (event.kind === 'release') {
    const cell = screenToCell(event.col, event.row);
    if (cell) {
      session.setSelection({
        startLine: dragStart.line,
        startCol: dragStart.col,
        endLine: cell.line,
        endCol: cell.col,
      });
    }
    const text = extractText(dragStart, cell ?? dragStart);
    dragging = false;
    dragStart = null;
    if (text) {
      copyToClipboard(text);
      session.flashNotice('Copied to clipboard');
    }
  }
}

// The transcript region's 1-based screen row is frame geometry shared with the
// cursor module; exposed for the Transcript component's registration call.
export { transcriptTopRow };