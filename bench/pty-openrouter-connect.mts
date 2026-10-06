// Picking OpenRouter from the provider list shows its explained connect screen, and Esc goes back (it used to strand).
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation(); await r.wait(1000);
r.send('/model'); await r.wait(200); r.send('\r'); await r.wait(1500);
const i = r.screen().findIndex((l) => l.includes('OpenRouter'));
for (let k = 0; k < 8; k++) { r.send('\x1b[A'); await r.wait(150); } r.send('\r'); await r.wait(1500);
console.log('screen:', r.screen().filter((l) => l.trim()).slice(0, 2).join(' | '));
r.send('\x1b'); await r.wait(1200);
console.log('after Esc:', r.screen().find((l) => l.trim()));
for (let k = 0; k < 3 && !/Settings\s+Picture/.test(r.text()); k++) { r.send('\x1b'); await r.wait(900); }
console.log('home:', /Settings\s+Picture/.test(r.text()));
r.kill(); await r.wait(300); process.exit(0);
