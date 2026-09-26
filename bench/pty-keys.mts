// Ordinary keys still work with the mouse filter in front of them.
import { Rig } from './pty-rig.mjs';
const r = new Rig();
await r.until((t) => t.includes('Just chat - no project'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
const ok: string[] = [];
r.send('hello'); await r.wait(300);
ok.push(`typing: ${r.screen()[28].includes('hello')}`);
r.send('\x1b[D\x1b[D'); await r.wait(300);   // two left arrows (whole sequences)
r.send('X'); await r.wait(300);
ok.push(`left arrows then X: ${r.screen()[28].includes('helXlo')}`);
r.send('\x03'); await r.wait(300);           // Ctrl+C clears the box
ok.push(`ctrl+c clears: ${r.screen()[28].replace(/[│ ]/g, '') === ''}`);
// the model picker opens with Ctrl+M (Enter) - use /help instead: type /help, Enter, then Esc closes it
r.send('/help'); await r.wait(200); r.send('\r'); await r.wait(600);
const inHelp = !r.text().includes('Settings   glm');
r.send('\x1b'); await r.wait(400);
ok.push(`help opened: ${inHelp}, Esc closed it (bare Escape reaches Ink after 40 ms): ${r.text().includes('Settings')}`);
console.log(ok.join('\n'));
r.kill(); process.exit(0);
