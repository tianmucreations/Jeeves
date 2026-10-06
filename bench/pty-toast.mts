// Copy something, look for the floating "Copied to clipboard" message, and check
// that nothing else on the screen moves while it shows and after it goes.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat - no project'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
r.send('Say something.'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Paragraph 8'), 60000, 'answer');
await r.wait(2500);
const before = r.screen();
const y = before.findIndex((l, i) => i > 3 && l.includes('▎') && l.includes('Spain'));
r.mouse('press', 8, y + 1); r.mouse('drag', 40, y + 1); r.mouse('release', 40, y + 1);
await r.wait(500);
const during = r.screen();
console.log('toast on screen:', during.some((l) => l.includes('Copied to clipboard')), '| row:', during.findIndex((l) => l.includes('Copied to clipboard')));
console.log(during.slice(1, 5).join('\n'));
const changed = during.map((l, i) => (l !== before[i] && !l.includes('Copied') && i !== y ? i : -1)).filter((i) => i >= 0 && i < 27 && i > 4);
console.log('other conversation rows that changed while it showed (bar = streaming may add):', changed.length);
await r.wait(3500);
console.log('toast gone after 3.5 s:', !r.text().includes('Copied to clipboard'));
r.kill(); await r.wait(500); process.exit(0);
