// Scroll back while Jeeves is still writing, then watch every screen change for
// the rest of the answer: a steady view is ONE picture (only the bottom bar's
// "reading history" and the top rows never move). Counts distinct pictures.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { ...(process.env.JEEVES_ZAI_BASE_URL ? { JEEVES_ZAI_BASE_URL: process.env.JEEVES_ZAI_BASE_URL } : {}), ...(process.env.HEARTBEAT ? { NODE_OPTIONS: `--require ${process.env.HEARTBEAT}` } : {}) });
await r.until((t) => t.includes('Just chat - no project'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
r.send('Write about 900 words on the history of Spain, in many short paragraphs.'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('▎') , 60000, 'answer starts');
await r.until(() => r.screen()[2].replace(/[│ ]/g, '').length > 0, 60000, 'screen full');
await r.wait(6000); // let the answer grow well past one screen before reading back
// a trackpad-style burst: 6 wheel notches in quick succession
const tWheel = Date.now();
for (let i = 0; i < 6; i++) { r.mouse('up', 50, 10); await r.wait(15); }
await r.until((t) => t.includes('reading history'), 20000, 'the wheel to take effect').catch(() => {});
console.log('wheel -> page moved (ms):', Date.now() - tWheel);
await r.wait(400);
console.log('input row after the burst:', JSON.stringify(r.screen()[28].trim()));
const pictures = new Map<string, number>();
const t0 = Date.now();
let last = '';
while (Date.now() - t0 < 12000) {
  const pic = r.screen().slice(2, 27).join('\n');
  if (pic !== last) { pictures.set(pic, (pictures.get(pic) ?? 0) + 1); last = pic; }
  await r.wait(10);
}
const all = [...pictures.keys()];
for (let i = 1; i < Math.min(all.length, 5); i++) { const a = all[i-1].split('\n'), b = all[i].split('\n'); console.log(`--- change ${i}:`); a.forEach((l, k) => { if (l !== b[k]) console.log(`  row ${k+2}:\n    was ${JSON.stringify(l.slice(0,60))}\n    now ${JSON.stringify(b[k].slice(0,60))}`); }); }
console.log('distinct pictures while the answer kept growing:', pictures.size, '(1 = perfectly steady)');
r.kill(); await r.wait(800); process.exit(0);
