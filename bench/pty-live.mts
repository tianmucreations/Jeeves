import { Rig } from './pty-rig.mjs';
import { readFileSync, existsSync } from 'node:fs';
const r = new Rig();
await r.until((t) => t.includes('Just chat - no project'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
r.send('List the files in your working folder, then write about 300 words on the history of Spain.');
await r.wait(300);
r.send('\r');
// 1. while running: what do the action lines look like?
let sawRunning = false, sawTick = false;
const box = (l: string) => l.replace(/^│ ?/, '').replace(/ ?│$/, '');
let anchorShots: string[][] = [];
let scrolled = false;
const t0 = Date.now();
while (Date.now() - t0 < 120000) {
  const t = r.text();
  if (t.includes('…') && /List|Listed/.test(t)) sawRunning = true;
  if (t.includes('✓')) sawTick = true;
  const answerLines = r.screen().filter((l) => l.includes('▎'));
  if (!scrolled && answerLines.length >= 6 && r.screen()[2].replace(/[│ ]/g, '').length > 0) {
    // scroll back up while he is still writing
    for (let i = 0; i < 3; i++) { r.mouse('up', 50, 10); await r.wait(80); }
    scrolled = true;
    await r.wait(600);
    anchorShots.push(r.screen().slice(2, 27).map(box));
    console.log('--- just after scrolling up (still writing?)', /Working|thinking/.test(r.text()) ? '' : '(finished already)');
    r.screen().slice(0, 32).forEach((l) => console.log(l));
    await r.wait(3500);
    anchorShots.push(r.screen().slice(2, 27).map(box));
    const same = JSON.stringify(anchorShots[0]) === JSON.stringify(anchorShots[1]);
    console.log('\nview unchanged after 3.5 s of more writing:', same);
    if (!same) { console.log('BEFORE:\n' + anchorShots[0].join('\n')); console.log('AFTER:\n' + anchorShots[1].join('\n')); }
    r.send('\x1b[F'); // End: back to the newest
  }
  if (scrolled && /reading history/.test(t) === false && Date.now() - t0 > 20000 && !/…/.test(t)) break;
  await r.wait(200);
}
await r.wait(3000);
console.log('\nsaw running action line:', sawRunning, ' | any ✓ tick line ever on screen:', sawTick);
console.log('\n--- final screen'); r.screen().forEach((l) => console.log(l));
// copy test: drag over two answer rows
const scr = r.screen(); const rowsWith = scr.map((l, i) => (l.includes('▎') ? i : -1)).filter((i) => i >= 0);
if (rowsWith.length >= 3) {
  const y1 = rowsWith[0] + 1, y2 = rowsWith[1] + 1; // 1-based
  r.mouse('press', 6, y1); r.mouse('drag', 40, y1); r.mouse('drag', 30, y2); r.mouse('release', 30, y2);
  await r.wait(1000);
  console.log('\nselected rows:', scr[y1 - 1].slice(3, 100).trim().slice(0, 40), '...');
  console.log('clipboard file exists:', existsSync('/private/tmp/jv-shim/clipboard.txt'));
  if (existsSync('/private/tmp/jv-shim/clipboard.txt')) console.log('CLIPBOARD =', JSON.stringify(readFileSync('/private/tmp/jv-shim/clipboard.txt', 'utf8')));
  console.log('bar says:', r.screen()[30].trim().slice(0, 100));
}
r.kill(); process.exit(0);
