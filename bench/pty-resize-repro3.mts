// REPRODUCE attempt 3: randomized resize storm (a real drag), while scrolled
// back reading, mid-stream, todo panel visible, question pending at times.
import { Rig } from './pty-rig.mjs';

function audit(r: Rig, label: string): boolean {
  const scr = r.screen();
  let bars = 0, tops = 0, bottoms = 0;
  for (const line of scr) {
    if (/Settings/.test(line) && /Session:|Week:|today/.test(line)) bars++;
    if (/^\s*╰/.test(line)) bottoms++;
    if (/^\s*╭/.test(line)) tops++;
  }
  const bad = bars !== 1 || tops !== 1 || bottoms !== 1;
  if (bad) { console.log(`CORRUPT [${label}] ${r.cols}x${r.rows} bars=${bars} tops=${tops} bottoms=${bottoms}`); scr.forEach((l, i) => console.log(`${String(i + 1).padStart(2)}|${l}`)); }
  return bad;
}

const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(800);
r.send('TODOTEST work through the steps then write 900 words on Spain');
await r.wait(300); r.send('\r');
await r.until((t) => t.includes('▎') || t.includes('○'), 30000, 'job starts');
await r.wait(1200);
// scroll back to read while it works (his words: he resized to READ what Jeeves wrote)
for (let i = 0; i < 8; i++) { r.mouse('up', 50, 10); await r.wait(20); }
let anyBad = false;
// storm: 150 random sizes, 8-25 ms apart, like a drag
let seed = 42;
const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
for (let i = 0; i < 150; i++) {
  const c = 60 + Math.floor(rand() * 90);   // 60-150 cols
  const rw = 5 + Math.floor(rand() * 50);   // 5-55 rows (includes below-minimum sizes)
  r.proc.resize(c, rw); r.term.resize(c, rw); r.cols = c; r.rows = rw;
  await r.wait(8 + Math.floor(rand() * 17));
}
await r.wait(2000);
anyBad = audit(r, 'after storm, scrolled, mid-job') || anyBad;
// keep streaming, storm again scrolled up
r.raw = '';
for (let i = 0; i < 100; i++) {
  const c = 70 + Math.floor(rand() * 80);
  const rw = 8 + Math.floor(rand() * 45);
  r.proc.resize(c, rw); r.term.resize(c, rw); r.cols = c; r.rows = rw;
  await r.wait(10);
}
await r.wait(2000);
anyBad = audit(r, 'after second storm mid-stream') || anyBad;
console.log(anyBad ? 'REPRODUCED' : 'NOT REPRODUCED (emulator)');
r.kill(); await r.wait(800); process.exit(anyBad ? 1 : 0);
