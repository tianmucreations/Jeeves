// Byte-level audit: replay the raw stream and count every moment the app writes
// past the bottom row (a real terminal SCROLLS when that happens; the emulator
// audit can miss it if rows land clipped). Also flag frames written while the
// cursor is parked beyond the window.
import { Rig } from './pty-rig.mjs';

const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(800);
r.send('Write about 900 words on the history of Spain, in many short paragraphs.');
await r.wait(300); r.send('\r');
await r.until((t) => t.includes('▎'), 30000, 'answer starts');
await r.wait(1500);

// Mark the stream so we can align resizes to raw offsets
const sizes: [number, number][] = [[114, 42], [118, 45], [108, 38], [100, 32], [120, 46], [110, 40]];
let mark = 0;
const marks: { at: number; cols: number; rows: number }[] = [];
r.raw = '';
setTimeout(() => {}, 0);
for (const [c, rw] of sizes) {
  await r.wait(150);
  marks.push({ at: r.raw.length, cols: c, rows: rw });
  r.proc.resize(c, rw); r.term.resize(c, rw); r.cols = c; r.rows = rw;
}
await r.wait(2500);

// Replay: track cursor row (1-based within viewport). LF at bottom row = scroll.
const events: string[] = [];
let row = 1, col = 1;
let idx = 0;
let cursorRows = 32;
let markI = 0;
const s = r.raw;
const control = /\x1b\[([0-9;?]*)([A-Za-z])/y;
while (idx < s.length) {
  while (markI < marks.length && idx === marks[markI].at) { cursorRows = marks[markI].rows; events.push(`resize→${cursorRows} at byte ${idx}`); markI++; }
  const ch = s[idx];
  if (ch === '\x1b') {
    control.lastIndex = idx;
    const m = control.exec(s);
    if (m) {
      const [, params, cmd] = m;
      if (cmd === 'H' || cmd === 'f') { const [a, b] = params.split(';'); row = a ? parseInt(a) : 1; col = b ? parseInt(b) : 1; }
      else if (cmd === 'A') row -= params ? parseInt(params) : 1;
      else if (cmd === 'B') row += params ? parseInt(params) : 1;
      else if (cmd === 'G') col = params ? parseInt(params) : 1;
      else if (cmd === 'J') events.push(`clear-screen at byte ${idx} (cursor row ${row}/${cursorRows})`);
      else if (cmd === 'r') events.push(`scroll-region ${params} at byte ${idx}`);
      idx += m[0].length; continue;
    }
    idx++; continue;
  }
  if (ch === '\n') { row++; if (row > cursorRows) { events.push(`SCROLL: LF past row ${cursorRows} at byte ${idx}`); row = cursorRows; } }
  else if (ch === '\r') col = 1;
  else if (ch !== '\x1b') col++;
  idx++;
}
console.log('resize marks:', marks.length, '| scroll/clear events:', events.length);
for (const e of events.slice(0, 40)) console.log(' ', e);
r.kill(); await r.wait(800); process.exit(0);
