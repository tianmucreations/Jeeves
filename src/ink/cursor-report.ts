// WHERE ON THE SCREEN IS THE WINDOW? (6 Oct)
// The live block (typing area, info bar, buttons) sits right under the printed
// history, and how much history is on screen depends on the terminal, its size and
// what it did with a clear. Counting it ourselves drifted by rows, so a click
// landed on the wrong thing. The terminal knows: asked "where is the cursor?"
// (ESC [ 6 n) it answers ESC [ row ; col R. Ink leaves the cursor on the row just
// under the info bar after every frame, so that one number places every button
// and the typing area exactly. The answers arrive on the keyboard line and are
// taken out in stdin-filter.ts before anything sees them as typing.
let onRow: ((row: number) => void) | null = null;
let timer: NodeJS.Timeout | null = null;

export function setCursorRowListener(listener: ((row: number) => void) | null): void {
  onRow = listener;
}

export function handleCursorReply(row: number): void {
  onRow?.(row);
}

// Ask once things have settled (a stream draws dozens of frames a second).
export function askCursorRowSoon(ms = 60): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => {
    timer = null;
    try {
      if (process.stdout.isTTY) process.stdout.write('\x1b[6n');
    } catch {
      // A closed stream must never crash the app.
    }
  }, ms);
  timer.unref?.();
}
