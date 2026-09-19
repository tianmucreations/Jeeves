import { spawn } from 'node:child_process';
import { session } from '../state/session.js';

// Selecting and copying in the conversation, after Claude Code's fullscreen mode
// (code.claude.com/docs/en/fullscreen, "Use the mouse"): click and drag selects,
// the selection copies to the clipboard when the mouse is released, and a short
// note says it was copied. Mouse capture (for wheel scrolling) stops the
// terminal's own selection, so without this nothing could be copied at all
// (reported 19 Sept).

export interface TextPoint {
  line: number;
  ch: number;
}

// A screen position (1-based column and row, as the mouse reports them) as a line
// and character of the drawn conversation. Outside the conversation area: null,
// unless clamp is set, when it is pinned to the nearest edge (for dragging past it).
export function pointAt(col: number, row: number, clamp = false): TextPoint | null {
  const view = session.transcriptView;
  if (!view) return null;
  let r = row - view.top;
  if (r < 0 || r >= view.height) {
    if (!clamp) return null;
    r = Math.max(0, Math.min(view.height - 1, r));
  }
  // The newest line sits on the bottom row; scrolling up moves older lines in.
  const line = view.lines.length - view.scrollTop - view.height + r;
  if (line < 0 || line >= view.lines.length) {
    if (!clamp) return null;
    return { line: Math.max(0, Math.min(view.lines.length - 1, line)), ch: line < 0 ? 0 : Number.MAX_SAFE_INTEGER };
  }
  return { line, ch: Math.max(0, col - view.left) };
}

// Start and end in reading order.
export function ordered(a: TextPoint, b: TextPoint): [TextPoint, TextPoint] {
  return a.line < b.line || (a.line === b.line && a.ch <= b.ch) ? [a, b] : [b, a];
}

// The selected characters of one drawn line, as [from, to), or null.
export function selectedRange(lineIndex: number, length: number): [number, number] | null {
  const sel = session.selection;
  if (!sel) return null;
  const [start, end] = ordered(sel.anchor, sel.focus);
  if (lineIndex < start.line || lineIndex > end.line) return null;
  const from = lineIndex === start.line ? Math.min(start.ch, length) : 0;
  const to = lineIndex === end.line ? Math.min(end.ch + 1, length) : length;
  return to > from ? [from, to] : null;
}

// The selected text: each line's selected part without the padding the display adds.
export function selectedText(lines: string[]): string {
  const sel = session.selection;
  if (!sel) return '';
  const [start, end] = ordered(sel.anchor, sel.focus);
  const out: string[] = [];
  for (let i = start.line; i <= end.line && i < lines.length; i++) {
    const range = selectedRange(i, lines[i].length);
    out.push(range ? lines[i].slice(range[0], range[1]).replace(/\s+$/, '') : '');
  }
  return out.join('\n').replace(/^\n+|\n+$/g, '');
}

// The Mac's own clipboard program, as Claude Code does; elsewhere the terminal's
// clipboard escape (OSC 52).
export function copyToClipboard(text: string): Promise<boolean> {
  if (process.platform !== 'darwin') {
    try {
      process.stdout.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
      return Promise.resolve(true);
    } catch {
      return Promise.resolve(false);
    }
  }
  return new Promise((resolve) => {
    try {
      const child = spawn('pbcopy', [], { stdio: ['pipe', 'ignore', 'ignore'] });
      child.on('error', () => resolve(false));
      child.on('close', (code) => resolve(code === 0));
      child.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}

let noteTimer: NodeJS.Timeout | null = null;

// Copies the selection and says so in the info bar for two seconds.
export async function copySelection(): Promise<void> {
  const view = session.transcriptView;
  const text = view ? selectedText(view.lines) : '';
  if (!text) return;
  const copied = await copyToClipboard(text);
  session.setBusyNote(copied ? 'copied' : "couldn't copy");
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    if (session.busyNote === 'copied' || session.busyNote === "couldn't copy") session.setBusyNote(null);
  }, 2000);
}
