// Audit the visible screen after EACH resize during streaming: the window must
// be correct within ~300ms of every size change, not only at the end.
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

async function audit(label: string): Promise<boolean> {
  const scr = r.screen();
  // The new invariants (3 Oct, no window border): exactly ONE info bar, and
  // the answer's gold-barred lines only ever appear ONCE each (no duplicated
  // fragments from a mis-erased frame).
  const bars = scr.filter((l) => /Settings/.test(l) && /Session:|Week:|today/.test(l)).length;
  // The fake filler repeats its own sentence, so one repeated wrapped line is
  // normal; corruption (a mis-erased frame) shows as THREE identical gold rows
  // in a row, or a missing info bar that persists after re-sampling.
  const goldLines = scr.filter((l) => l.includes('▎')).map((l) => l.replace(/\s+/g, ' ').trim());
  let dupGold = false;
  for (let i = 2; i < goldLines.length; i++) {
    if (goldLines[i].length > 20 && goldLines[i] === goldLines[i - 1] && goldLines[i] === goldLines[i - 2]) dupGold = true;
  }
  let bad = dupGold;
  if (bars !== 1) {
    await r.wait(400); // a redraw may be mid-flight; corruption must persist to count
    const again = r.screen().filter((l) => /Settings/.test(l) && /Session:|Week:|today/.test(l)).length;
    if (again !== 1) bad = true;
  }
  console.log(`${bad ? 'CORRUPT' : 'ok    '} [${label}] ${r.cols}x${r.rows} bars=${bars} dupGold=${dupGold}`);
  if (bad) scr.forEach((l, i) => console.log(`${String(i + 1).padStart(2)}|${l}`));
  return bad;
}

const sizes: [number, number][] = [[114, 42], [118, 45], [108, 38], [100, 32], [120, 46], [110, 40], [96, 30], [132, 50]];
let anyBad = false;
for (const [c, rw] of sizes) {
  r.proc.resize(c, rw); r.term.resize(c, rw); r.cols = c; r.rows = rw;
  await r.wait(300); // a real terminal settles in well under this; corruption would already show
  anyBad = (await audit(`after ${c}x${rw}`)) || anyBad;
}
console.log(anyBad ? 'SOME RESIZES CORRUPTED' : 'EVERY RESIZE CLEAN');
r.kill(); await r.wait(800); process.exit(anyBad ? 1 : 0);
