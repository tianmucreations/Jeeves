// DECSCUSR cursor-shape sequences. The app switches the terminal's real cursor to a
// steady block while it runs (the way Claude Code does) and restores the shell's
// default shape when it quits. Not reverse-video fakery: the terminal's own cursor.
export const BLOCK_CURSOR = '\x1b[2 q';
export const DEFAULT_CURSOR = '\x1b[0 q';

// The app frame's fixed layout (see src/app.tsx): a bordered, one-column-padded box
// of the full terminal height containing header, transcript, separator, input,
// separator, footer. These 1-based screen coordinates describe where the regions sit
// inside that frame; the cursor and the mouse-selection mapping both depend on them.
export function transcriptTopRow(): number {
  // Screen row 1: top border. Row 2: header. Row 3: first transcript row.
  return 3;
}

export function contentColumn(): number {
  // Column 1: left border. Column 2: padding. Column 3: first text column.
  return 3;
}

// 0-based Ink-frame row of the input line (relative to the frame origin, which is
// the alt screen's home position): transcript height is rows-7, then the separator
// row follows, then the input row.
export function inputFrameRow(rows: number): number {
  return rows - 7 + 3;
}