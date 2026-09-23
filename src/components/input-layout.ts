import stringWidth from 'string-width';

export interface InputView {
  // The visible text, split so trailing spaces can be styled apart from the rest.
  text: string;
  trailingSpaces: string;
  // Terminal columns the visible text occupies; the cursor sits right after it.
  width: number;
}

// What the one-row input shows, and where the cursor goes. Two rules keep Ink off
// its cursor-only update path, which in an exactly-fullscreen frame draws the
// cursor two rows above the y passed (onto the separator - measured in a pty):
//
// 1. Text wider than the row shows only its tail, so the cursor never runs past
//    the row and every keystroke changes what is drawn. (Left to wrap, the extra
//    characters landed on a clipped second line: the frame stayed identical
//    while the cursor moved, and the cursor climbed up through the transcript.)
// 2. Trailing spaces are returned separately so the caller can style them (dim):
//    a plain trailing space is indistinguishable from the row's padding, so
//    "hello " and "hello" would otherwise be byte-identical frames.
//
// maxWidth leaves one column spare so the cursor itself stays inside the row.
export function inputView(value: string, rowWidth: number): InputView {
  const maxWidth = Math.max(1, rowWidth - 1);
  const chars = Array.from(value);
  let width = 0;
  let start = chars.length;
  while (start > 0) {
    const next = stringWidth(chars[start - 1]);
    if (width + next > maxWidth) break;
    width += next;
    start -= 1;
  }
  const visible = chars.slice(start).join('');
  const text = visible.replace(/ +$/, '');
  return { text, trailingSpaces: visible.slice(text.length), width };
}

// Backspace removes one whole character, never half of a surrogate pair.
export function dropLastChar(value: string): string {
  return Array.from(value).slice(0, -1).join('');
}

export interface InputRow {
  text: string;
  trailingSpaces: string;
  // A dim "more lines above/below" line in place of message text.
  hint?: boolean;
  // Where this row starts in the message, counted in characters (text rows only).
  start?: number;
  // The cursor's place in this row when it is inside the text rather than at the
  // end: the character drawn highlighted (text.length means just after the text).
  cursorAt?: number;
}

export interface InputLayout {
  // The rows to draw; at most maxRows.
  rows: InputRow[];
  // Terminal columns the last row occupies; the cursor sits right after it.
  cursorX: number;
  // How far the view is scrolled back from the end of the message (clamped),
  // and the furthest it can go. 0 means the end - where the typing is - shows.
  scrollUp: number;
  maxScrollUp: number;
  // With a cursor inside the text: whether its row is on screen, and which of all
  // the message's rows it is on.
  cursorVisible: boolean;
  cursorLine: number;
}

interface Line {
  text: string;
  start: number;
}

// Wraps at word boundaries (a space at the edge ends the row and is not drawn),
// remembering where each row starts in the message so the cursor and clicks can
// be placed. Pasted line breaks start new rows.
function wrapLines(chars: string[], maxWidth: number): Line[] {
  const lines: Line[] = [];
  let paragraphStart = 0;
  const value = chars.join('');
  for (const paragraph of value.split('\n')) {
    const pchars = Array.from(paragraph);
    let line = '';
    let lineStart = paragraphStart;
    pchars.forEach((ch, i) => {
      const at = paragraphStart + i;
      if (stringWidth(line + ch) <= maxWidth) {
        line += ch;
        return;
      }
      if (ch === ' ') {
        // A space at the edge ends the row; the next word starts the next row.
        lines.push({ text: line, start: lineStart });
        line = '';
        lineStart = at + 1;
        return;
      }
      const lineChars = Array.from(line);
      const lastSpace = lineChars.lastIndexOf(' ');
      if (lastSpace > 0) {
        lines.push({ text: lineChars.slice(0, lastSpace).join(''), start: lineStart });
        line = lineChars.slice(lastSpace + 1).join('') + ch;
        lineStart = lineStart + lastSpace + 1;
      } else {
        lines.push({ text: line, start: lineStart });
        line = ch;
        lineStart = at;
      }
    });
    lines.push({ text: line, start: lineStart });
    paragraphStart += pchars.length + 1;
  }
  return lines;
}

// Which row a character position is on: the last row starting at or before it.
function lineOf(lines: Line[], position: number): number {
  let found = 0;
  lines.forEach((line, index) => {
    if (line.start <= position) found = index;
  });
  return found;
}

// The input box grows as the message does (as in Claude Code): the text wraps at
// word boundaries onto new rows, up to maxRows, then the oldest rows scroll away so
// the end of the message - where the typing is - shows. A message taller than the
// box can be read back: scrollUp moves the view towards the start (Claude Code's
// Up/Down move through a message that spans more than one line), and a dim line
// at the top or bottom says how many lines are out of view. Pasted line breaks
// start new rows. One column is kept spare so the cursor stays inside the box.
// This keeps inputView's two rules: every keystroke still changes what is drawn (a
// wrap adds a row, which resizes the box), and the last row's trailing spaces are
// returned apart so they can be styled.
// cursor: the cursor's place in the message in characters, or null for the end.
// Inside the text it is drawn as a highlighted character, as Claude Code draws it,
// which also keeps every cursor move a visible change.
export function inputLayout(value: string, rowWidth: number, maxRows = 6, scrollUp = 0, cursor: number | null = null): InputLayout {
  const maxWidth = Math.max(1, rowWidth - 1);
  const chars = Array.from(value);
  const lines = wrapLines(chars, maxWidth);
  const inside = cursor !== null && cursor < chars.length;
  const cursorLine = inside ? lineOf(lines, cursor) : lines.length - 1;
  const mark = (line: Line, index: number, row: InputRow): InputRow => {
    if (!inside || index !== cursorLine) return row;
    return { ...row, cursorAt: Math.min(cursor - line.start, Array.from(line.text).length) };
  };
  if (lines.length <= maxRows) {
    const rows = lines.map((line, index) => {
      if (index < lines.length - 1 || inside) return mark(line, index, { text: line.text, trailingSpaces: '', start: line.start });
      const text = line.text.replace(/ +$/, '');
      return { text, trailingSpaces: line.text.slice(text.length), start: line.start };
    });
    return { rows, cursorX: stringWidth(lines[lines.length - 1]?.text ?? ''), scrollUp: 0, maxScrollUp: 0, cursorVisible: true, cursorLine };
  }
  // Too tall for the box. Scrolled all the way back, the first maxRows-1 lines show
  // above a "below" hint; at the end, a hint above the last maxRows-1 lines.
  const maxScrollUp = lines.length - (maxRows - 1);
  const up = Math.max(0, Math.min(scrollUp, maxScrollUp));
  const end = lines.length - up;
  const slots = maxRows - (up > 0 ? 1 : 0);
  const start = end - slots <= 0 ? 0 : end - (slots - 1);
  const rows: InputRow[] = [];
  // A hint never wraps: in a narrow window it is cut to the row.
  const hint = (text: string): InputRow => ({ text: Array.from(text).slice(0, maxWidth).join(''), trailingSpaces: '', hint: true });
  if (start > 0) rows.push(hint(`↑ ${start} more line${start === 1 ? '' : 's'} above - scroll or ↑ ↓ to read`));
  lines.slice(start, end).forEach((line, offset, shown) => {
    const index = start + offset;
    if (up > 0 || inside || offset < shown.length - 1) {
      rows.push(mark(line, index, { text: line.text, trailingSpaces: '', start: line.start }));
      return;
    }
    const text = line.text.replace(/ +$/, '');
    rows.push({ text, trailingSpaces: line.text.slice(text.length), start: line.start });
  });
  if (up > 0) rows.push(hint(`↓ ${up} more line${up === 1 ? '' : 's'} below - ↓ or keep typing to return`));
  return {
    rows,
    cursorX: stringWidth(lines[lines.length - 1]?.text ?? ''),
    scrollUp: up,
    maxScrollUp,
    cursorVisible: cursorLine >= start && cursorLine < end,
    cursorLine,
  };
}

// The scroll position that brings a cursor inside the text into view, keeping the
// current one when it already shows.
export function scrollToShowCursor(value: string, rowWidth: number, maxRows: number, scrollUp: number, cursor: number | null): number {
  const first = inputLayout(value, rowWidth, maxRows, scrollUp, cursor);
  if (first.cursorVisible || first.maxScrollUp === 0) return first.scrollUp;
  for (let up = 0; up <= first.maxScrollUp; up++) {
    if (inputLayout(value, rowWidth, maxRows, up, cursor).cursorVisible) return up;
  }
  return first.scrollUp;
}

// Word jumps (Option + arrows): to the start of the previous word, or the end of the next.
export function previousWordStart(value: string, cursor: number): number {
  const chars = Array.from(value);
  let i = Math.min(cursor, chars.length);
  while (i > 0 && /\s/.test(chars[i - 1])) i--;
  while (i > 0 && !/\s/.test(chars[i - 1])) i--;
  return i;
}

export function nextWordEnd(value: string, cursor: number): number {
  const chars = Array.from(value);
  let i = cursor;
  while (i < chars.length && /\s/.test(chars[i])) i++;
  while (i < chars.length && !/\s/.test(chars[i])) i++;
  return i;
}

// A burst of typed characters can arrive together with Enter (when Jeeves is busy
// and the keyboard runs ahead). The text before the first line break is typed text,
// and the break itself is Enter. Measured 18 Sept: the break was otherwise stored in
// the message as a carriage return, which pushed the text over the window's border.
export function splitTypedBurst(input: string): { typed: string; enter: boolean; rest: string } {
  const match = /\r\n|\r|\n/.exec(input);
  if (!match) return { typed: input, enter: false, rest: '' };
  return { typed: input.slice(0, match.index), enter: true, rest: input.slice(match.index + match[0].length).replace(/\r\n|\r/g, '\n') };
}

// Pasted text keeps its line breaks (as newlines) and never sends by itself.
export function cleanPaste(text: string): string {
  return text.replace(/\r\n|\r/g, '\n').replace(/\t/g, '  ');
}
