// Every Settings row: open it, look at it, press Esc until home (at most 4), never stuck.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 40, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation(); await r.wait(1000);
const home = () => /Settings\s+Picture/.test(r.text());
r.send('/settings'); await r.wait(200); r.send('\r'); await r.wait(1200);
const labels = r.screen().filter((l) => /^ {3}|^ ✓ /.test(l)).map((l) => l.trim());
console.log(labels.length, 'rows:\n' + labels.join('\n'));
r.send('\x1b'); await r.wait(900);
const skip = /Quit|Start fresh|Clear|Undo|Save|Just chat|Run in|Plan|Copy/i;
let stuck = 0;
for (let i = 0; i < labels.length; i++) {
  if (skip.test(labels[i])) continue;
  r.send('/settings'); await r.wait(200); r.send('\r'); await r.wait(900);
  const rowIdx = r.screen().findIndex((l) => l.includes(labels[i].slice(0, 20)));
  r.mouse('press', 6, rowIdx + 1); r.mouse('release', 6, rowIdx + 1); await r.wait(1500);
  const top = r.screen().find((l) => l.trim())?.trim().slice(0, 45);
  let presses = 0;
  while (!home() && presses < 4) { r.send('\x1b'); presses++; await r.wait(900); }
  const ok = home();
  if (!ok) stuck++;
  console.log(String(i).padStart(2), labels[i].slice(0, 28).padEnd(28), '→', (top ?? '').padEnd(46), 'Esc x' + presses, ok ? 'OK' : 'STUCK');
}
console.log('STUCK', stuck);
r.kill(); await r.wait(300); process.exit(0);
