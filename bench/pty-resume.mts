// Chat, quit, reopen, and carry on from the saved conversation. Needs fake-zai and the shim.
import { Rig } from './pty-rig.mjs';
const env = { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' };
async function boot() {
  const r = new Rig(100, 32, env);
  await r.bootConversation();
  return r;
}
let r = await boot();
r.send('Tell me about the history of Spain please'); await r.wait(300); r.send('\r');
// Wait for the WHOLE answer AND its settle into the terminal's own history
// (the fake answer ends at Chapter 10) - not just its first lines.
await r.until(() => r.historyText().includes('Chapter 10'), 90000, 'answer settled into history');
r.send('\x1b'); await r.wait(1500);
r.send('\x03'); await r.wait(300); r.send('\x03'); await r.wait(1500); r.kill(); await r.wait(500);
r = await boot();
console.log('fresh screen has old chat?', r.text().includes('history of Spain'));
// The typed door (mouse is off in the plain conversation - the terminal's own
// scrolling and selection own the wheel and the click now).
r.send('/settings');
await r.wait(300); r.send('\r');
await r.until((t) => t.includes('SETTINGS'), 8000, 'settings');
const at = r.screen().findIndex((l) => l.includes('Earlier conversations'));
console.log('settings row found at', at);
r.mouse('press', 10, at + 1); r.mouse('release', 10, at + 1);
await r.until((t) => t.includes('EARLIER CONVERSATIONS'), 8000, 'list');
console.log(r.screen().slice(0, 4).join('\n'));
r.send('\r');
await r.until((t) => t.includes('Carrying on') || t.includes('history of Spain'), 8000, 'resumed');
await r.wait(1000); // the restored conversation flushes into history a frame later
// The answer lives in the terminal's own history (scrollback) now - the
// honest check reads the history, not just the visible viewport.
console.log('after resume has old chat?', r.text().includes('history of Spain'), '| has answer in scrollback?', r.historyText().includes('Paragraph'));
r.kill(); await r.wait(300); process.exit(0);
