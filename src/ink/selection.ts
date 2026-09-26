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
  // An answer line's gold bar is in front of its text, not part of it.
  return { line, ch: Math.max(0, col - view.left - (view.gutters?.[line] ?? 0)) };
}

// Double-click selects a word (Claude Code's selection.ts wordBoundsAt): the run of
// characters of the same kind at the click - letters, digits and the marks that
// glue paths and addresses together (/ . - + ~ _), or a run of other punctuation.
// A click on plain space selects nothing. Returns [from, to) in the line's text.
const WORD_CHAR = /[\p{L}\p{N}_/.\-+~\\]/u;
function charClass(c: string): 0 | 1 | 2 {
  if (c === ' ' || c === '') return 0;
  return WORD_CHAR.test(c) ? 1 : 2;
}
export function wordBoundsAt(text: string, ch: number): [number, number] | null {
  const chars = Array.from(text);
  if (ch < 0 || ch >= chars.length) return null;
  const cls = charClass(chars[ch]);
  if (cls === 0) return null;
  let from = ch;
  let to = ch + 1;
  while (from > 0 && charClass(chars[from - 1]) === cls) from--;
  while (to < chars.length && charClass(chars[to]) === cls) to++;
  return [from, to];
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

// As Claude Code (ink/termio/osc.ts setClipboard): the terminal's clipboard escape
// (OSC 52) always, and - on this computer, not over SSH - its own clipboard
// program too, because OSC 52 depends on terminal settings (several Linux terminals
// ignore it): pbcopy on a Mac, clip on Windows, and on Linux the first of wl-copy
// (Wayland), xclip or xsel (X11) that exists, remembered after the first copy.
let linuxCopy: [string, string[]] | null | undefined;

function runCopy(program: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(program, args, { stdio: ['pipe', 'ignore', 'ignore'] });
      const timer = setTimeout(() => child.kill(), 2000);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}

export async function copyNative(text: string): Promise<boolean> {
  if (process.platform === 'darwin') return runCopy('pbcopy', [], text);
  if (process.platform === 'win32') return runCopy('clip', [], text);
  if (linuxCopy === null) return false;
  if (linuxCopy) return runCopy(linuxCopy[0], linuxCopy[1], text);
  const candidates: [string, string[]][] = [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const candidate of candidates) {
    if (await runCopy(candidate[0], candidate[1], text)) {
      linuxCopy = candidate;
      return true;
    }
  }
  linuxCopy = null;
  return false;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  let sent = false;
  try {
    process.stdout.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
    sent = true;
  } catch {
    // A closed stream: the clipboard program below may still work.
  }
  if (process.env.SSH_CONNECTION) return sent;
  return (await copyNative(text)) || sent;
}

// Copies the selection and says so in a small message floating in the corner of the
// window for three seconds (OpenCode's "Copied to clipboard" toast). The selection
// stays highlighted; nothing else on the screen moves.
export async function copySelection(): Promise<void> {
  const view = session.transcriptView;
  const text = view ? selectedText(view.lines) : '';
  if (!text) return;
  const copied = await copyToClipboard(text);
  if (copied) session.showToast('Copied to clipboard');
  else session.showToast("Couldn't copy that", 'error');
}
