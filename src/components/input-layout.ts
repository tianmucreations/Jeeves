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
}

export interface InputLayout {
  // The rows to draw, newest last; at most maxRows (older rows scroll away).
  rows: InputRow[];
  // Terminal columns the last row occupies; the cursor sits right after it.
  cursorX: number;
}

// The input box grows as the message does (as in Claude Code): the text wraps at
// word boundaries onto new rows, up to maxRows, then the oldest rows scroll away so
// the end of the message - where the typing is - always shows. Pasted line breaks
// start new rows. One column is kept spare so the cursor stays inside the box.
// This keeps inputView's two rules: every keystroke still changes what is drawn (a
// wrap adds a row, which resizes the box), and the last row's trailing spaces are
// returned apart so they can be styled.
export function inputLayout(value: string, rowWidth: number, maxRows = 6): InputLayout {
  const maxWidth = Math.max(1, rowWidth - 1);
  const lines: string[] = [];
  for (const paragraph of value.split('\n')) {
    let line = '';
    for (const ch of Array.from(paragraph)) {
      if (stringWidth(line + ch) <= maxWidth) {
        line += ch;
        continue;
      }
      if (ch === ' ') {
        // A space at the edge ends the row; the next word starts the next row.
        lines.push(line);
        line = '';
        continue;
      }
      const lastSpace = line.lastIndexOf(' ');
      if (lastSpace > 0) {
        lines.push(line.slice(0, lastSpace));
        line = line.slice(lastSpace + 1) + ch;
      } else {
        lines.push(line);
        line = ch;
      }
    }
    lines.push(line);
  }
  const shown = lines.slice(-maxRows);
  const rows = shown.map((line, index) => {
    if (index < shown.length - 1) return { text: line, trailingSpaces: '' };
    const text = line.replace(/ +$/, '');
    return { text, trailingSpaces: line.slice(text.length) };
  });
  return { rows, cursorX: stringWidth(shown[shown.length - 1] ?? '') };
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
