// REPRODUCE attempt 2: a real drag sends MANY resize events in a burst, not one.
// His screenshots also show the to-do panel on screen while working. Same audit:
// one bar, one pair of borders, always.
import { Rig } from './pty-rig.mjs';

function audit(r: Rig, label: string) {
  const scr = r.screen();
  let bars = 0, tops = 0, bottoms = 0;
  for (const line of scr) {
    if (/Settings/.test(line) && /Session:|Week:|today/.test(line)) bars++;
    if (/^\s*╰/.test(line)) bottoms++;
    if (/^\s*╭/.test(line)) tops++;
  }
  const bad = bars !== 1 || tops !== 1 || bottoms !== 1;
  console.log(`${bad ? 'CORRUPT' : 'ok    '} [${label}] ${r.cols}x${r.rows} bars=${bars} topBorders=${tops} bottomBorders=${bottoms}`);
  if (bad) scr.forEach((l, i) => console.log(`${String(i + 1).padStart(2)}|${l}`));
  return bad;
}

const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(800);
// TODOTEST: the pretend service runs a job with a to-do list on screen, like his screenshots
r.send('TODOTEST please work through the steps');
await r.wait(300); r.send('\r');
await r.until((t) => t.includes('●') || t.includes('○'), 30000, 'todo panel');

let anyBad = false;
// drag-style burst: many size changes with small waits, while working
const sizes: [number, number][] = [
  [104, 34], [108, 36], [112, 39], [114, 42], [118, 45], [120, 46], [116, 44], [112, 41],
  [108, 38], [104, 35], [100, 32], [96, 30], [100, 33], [106, 37], [112, 41], [118, 44],
];
for (const [c, rw] of sizes) {
  r.proc.resize(c, rw); r.term.resize(c, rw); r.cols = c; r.rows = rw;
  await r.wait(90); // a drag fires events tens of ms apart
}
await r.wait(1500);
anyBad = audit(r, 'after drag burst mid-job') || anyBad;

// and one more burst while plainly streaming a long answer
r.send('Write about 900 words on the history of Spain, in many short paragraphs.');
await r.wait(300); r.send('\r');
await r.until((t) => t.includes('▎'), 30000, 'answer starts');
await r.wait(1500);
for (const [c, rw] of sizes) {
  r.proc.resize(c, rw); r.term.resize(c, rw); r.cols = c; r.rows = rw;
  await r.wait(70);
}
await r.wait(1500);
anyBad = audit(r, 'after drag burst mid-stream') || anyBad;
r.kill(); await r.wait(800);
console.log(anyBad ? 'REPRODUCED' : 'NOT REPRODUCED');
process.exit(anyBad ? 1 : 0);
