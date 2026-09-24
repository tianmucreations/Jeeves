// DECSCUSR cursor-shape sequences. The app switches the terminal's real cursor to a
// steady block while it runs (the way Claude Code does) and restores the shell's
// default shape when it quits. Not reverse-video fakery: the terminal's own cursor.
export const BLOCK_CURSOR = '\x1b[2 q';
export const DEFAULT_CURSOR = '\x1b[0 q';

// The main window's fixed rows (see src/app.tsx): top border 1, header 1,
// transcript flexGrow (rows-7), separator 1, input 1, separator 1, info bar 1
// (the box's bottom content row, layout A), bottom border 1. The input text
// sits on 0-based frame row rows-4. Ink's cursor placement in an
// exactly-fullscreen frame (outputHeight >= terminal rows) lands the visible
// cursor one row ABOVE the y passed to setCursorPosition - buildCursorSuffix
// moves up visibleLineCount - y from the last written line (row
// visibleLineCount-1), which resolves to y-1 (verified against a real pty
// capture). So the y passed here is the input row plus one: rows-3, which draws
// the block cursor on the input text's own row, clear of the separator above
// and the separator below.
export function inputFrameRow(rows: number): number {
  return rows - 3;
}