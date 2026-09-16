// DECSCUSR cursor-shape sequences. The app switches the terminal's real cursor to a
// steady block while it runs (the way Claude Code does) and restores the shell's
// default shape when it quits. Not reverse-video fakery: the terminal's own cursor.
export const BLOCK_CURSOR = '\x1b[2 q';
export const DEFAULT_CURSOR = '\x1b[0 q';

// The main layout's fixed slot heights (see src/app.tsx): header 1 row, transcript
// flexGrow, input 2 rows (separator + prompt), footer 1 row. The input's prompt
// text sits on the second row of its slot, 0-based frame row rows-2, flush at
// column 0 - there is no border or padding in the slot layout.
export function inputFrameRow(rows: number): number {
  return rows - 2;
}