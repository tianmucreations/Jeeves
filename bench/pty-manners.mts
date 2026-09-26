// Three declined actions: each reply should be ONE short sentence, no deliberation.
// (The GLM-5.3-Flash "thinks in plain text" habit is the thing being watched.)
import { Rig } from './pty-rig.mjs';
const r = new Rig();
await r.until((t) => t.includes('Just chat - no project'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
const asks = ['Please create a text file called plan.txt containing the word hello.', 'Make a new folder called photos for me.', 'Save a note called shopping.txt that says milk and eggs.'];
for (const ask of asks) {
  r.send(ask); await r.wait(300); r.send('\r');
  await r.until((t) => /Allow/.test(t) && /Decline/.test(t), 90000, 'question');
  await r.wait(400); r.send('n');
  const before = r.raw.length;
  await r.wait(9000);
  const s = r.screen(); const at = s.map((l, i) => (l.includes('you said no') ? i : -1)).filter((i) => i >= 0).pop() ?? 0;
  console.log(`\n### ${ask}`);
  s.slice(at, 27).forEach((l) => { const t = l.replace(/^│ ?/, '').replace(/ ?│$/, '').trimEnd(); if (t.trim()) console.log('   ' + t); });
}
r.kill(); process.exit(0);
