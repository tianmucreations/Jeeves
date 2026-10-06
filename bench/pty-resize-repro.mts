// REPRODUCE the owner's screenshots 2 and 3: resize the window while Jeeves is
// working and watch the frame corrupt (duplicate bars, stray borders, stacked
// fragments below the box). Success = the screen always contains exactly one
// info bar and one pair of corners, at every size, mid-stream or not.
import { Rig } from './pty-rig.mjs';

function audit(r: Rig, label: string) {
  const rows = r.rows;
  const scr = r.screen();
  let bars = 0, corners = 0, tops = 0, bottoms = 0, seps = 0;
  for (const line of scr) {
    if (/Settings/.test(line) && /Session:|Week:|today/.test(line)) bars++;
    if (/^\s*╰/.test(line)) bottoms++;
    if (/^\s*╭/.test(line)) tops++;
    if (/^\s*├/.test(line)) seps++;
    corners = tops + bottoms;
  }
  const bad = bars !== 1 || tops !== 1 || bottoms !== 1;
  console.log(`${bad ? 'CORRUPT' : 'ok    '} [${label}] ${r.cols}x${r.rows} bars=${bars} topBorders=${tops} bottomBorders=${bottoms} separators=${seps}`);
  if (bad) {
    scr.forEach((l, i) => console.log(`${String(i + 1).padStart(2)}|${l}`));
  }
  return bad;
}

const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(800);
r.send('Write about 900 words on the history of Spain, in many short paragraphs.');
await r.wait(300); r.send('\r');
await r.until((t) => t.includes('▎'), 30000, 'answer starts');
await r.wait(2500); // answer streaming

let anyBad = false;
// grow while working (his exact action)
r.proc.resize(120, 45); r.term.resize(120, 45); r.cols = 120; r.rows = 45;
await r.wait(1200);
anyBad = audit(r, 'grown mid-stream') || anyBad;
// shrink mid-stream
r.proc.resize(80, 24); r.term.resize(80, 24); r.cols = 80; r.rows = 24;
await r.wait(1200);
anyBad = audit(r, 'shrunk mid-stream') || anyBad;
// grow again, then settle
r.proc.resize(110, 40); r.term.resize(110, 40); r.cols = 110; r.rows = 40;
await r.wait(1200);
anyBad = audit(r, 'grown again mid-stream') || anyBad;

// wait for the answer to finish, then audit once more at rest
await r.until((t) => !t.includes('reading history') && (t.match(/▎/g)?.length ?? 0) >= 0, 60000, 'answer end').catch(() => {});
await r.wait(3000);
anyBad = audit(r, 'at rest after answer') || anyBad;

// resize at rest too (his screenshot 3 was during working; check both)
r.proc.resize(130, 48); r.term.resize(130, 48); r.cols = 130; r.rows = 48;
await r.wait(1500);
anyBad = audit(r, 'grown at rest') || anyBad;

console.log(anyBad ? 'REPRODUCED: the frame corrupts on resize' : 'NOT REPRODUCED: screen stayed clean');
r.kill(); await r.wait(800); process.exit(anyBad ? 1 : 0);
