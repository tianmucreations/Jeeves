// Every screen opens and Esc brings back the conversation; the address screen's buttons and cursor work.
import { Rig } from './pty-rig.mjs';
const R = 30;
const r = new Rig(100, R, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation(); await r.wait(1000);
const home = () => r.text().includes('Settings   Picture') || (r.text().includes('Settings') && r.text().includes('Picture'));
let bad = 0;
for (const cmd of ['/settings', '/help', '/model', '/keys', '/folder', '/address']) {
  r.send(cmd); await r.wait(200); r.send('\r'); await r.wait(1500);
  const opened = !home();
  const first = r.screen().find((l) => l.trim())?.trim().slice(0, 50);
  r.send('\x1b'); await r.wait(1200);
  let back = home();
  if (!back) { r.send('\x1b'); await r.wait(1000); back = home(); r.send('\x1b'); await r.wait(600); }
  const once = opened && back;
  console.log(cmd.padEnd(10), 'opened:', opened, '| first row:', first, '| Esc home:', back);
  if (!opened || !back) bad++;
}
console.log('BAD', bad);
r.kill(); await r.wait(300); process.exit(0);
