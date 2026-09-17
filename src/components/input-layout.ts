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
