// DECSCUSR cursor-shape sequences. The app switches the terminal's real cursor to a
// steady block while it runs (the way Claude Code does) and restores the shell's
// default shape when it quits. Not reverse-video fakery: the terminal's own cursor.
export const BLOCK_CURSOR = '\x1b[2 q';
export const DEFAULT_CURSOR = '\x1b[0 q';

// The main layout's fixed slot heights (see src/app.tsx): header 1 row, transcript
// flexGrow, separator 1, input 1, separator 1, footer 1. The input text therefore
// sits on 0-based frame row rows-3. Ink's cursor placement in an exactly-fullscreen
// frame (outputHeight >= terminal rows) lands the visible cursor one row ABOVE the
// y passed to setCursorPosition - buildCursorSuffix moves up
// visibleLineCount - y from the last written line (row visibleLineCount-1), which
// resolves to y-1 (verified against a real pty capture). So the y passed here is
// the input row plus one: rows-2, which draws the block cursor on the input text's
// own row, clear of both separator lines.
export function inputFrameRow(rows: number): number {
  return rows - 2;
}