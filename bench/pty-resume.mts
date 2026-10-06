// Chat, quit, reopen, and carry on from the saved conversation. Needs fake-zai and the shim.
import { Rig } from './pty-rig.mjs';
const env = { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' };
async function boot() {
  const r = new Rig(100, 32, env);
  await r.until((t) => t.includes('Just chat - no project folder'), 15000);
  r.send('\r');
  await r.until((t) => t.includes('Settings'), 15000, 'conversation');
  await r.wait(1200);
  return r;
}
let r = await boot();
r.send('Tell me about the history of Spain please'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Paragraph 3'), 60000, 'answer');
r.send('\x1b'); await r.wait(1500);
r.send('\x03'); await r.wait(300); r.send('\x03'); await r.wait(1500); r.kill(); await r.wait(500);
r = await boot();
console.log('fresh screen has old chat?', r.text().includes('history of Spain'));
r.mouse('press', 4, 31); r.mouse('release', 4, 31);
await r.until((t) => t.includes('SETTINGS'), 8000, 'settings');
const at = r.screen().findIndex((l) => l.includes('Earlier conversations'));
console.log('settings row found at', at);
r.mouse('press', 10, at + 1); r.mouse('release', 10, at + 1);
await r.until((t) => t.includes('EARLIER CONVERSATIONS'), 8000, 'list');
console.log(r.screen().slice(0, 4).join('\n'));
r.send('\r');
await r.until((t) => t.includes('Carrying on'), 8000, 'resumed');
console.log('after resume has old chat?', r.text().includes('history of Spain'), '| has answer?', r.text().includes('Paragraph'));
r.kill(); await r.wait(300); process.exit(0);
