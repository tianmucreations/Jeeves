import { Rig } from './pty-rig.mjs';
import { readFileSync, existsSync } from 'node:fs';
const r = new Rig();
await r.until((t) => t.includes('Just chat - no project'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
r.send('Reply with exactly: The quick brown fox jumps.'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('▎ ') && t.includes('jumps'), 60000, 'answer');
await r.wait(2500);
const scr = r.screen(); const y = scr.findIndex((l) => l.includes('▎') && l.includes('brown'));
const x = scr[y].indexOf('brown'); // 0-based screen col
// double-click on "brown"
r.mouse('press', x + 2, y + 1); r.mouse('release', x + 2, y + 1);
await r.wait(120);
r.mouse('press', x + 2, y + 1); r.mouse('release', x + 2, y + 1);
await r.wait(1200);
console.log('double-click clipboard =', JSON.stringify(existsSync('/private/tmp/jv-shim/clipboard.txt') ? readFileSync('/private/tmp/jv-shim/clipboard.txt', 'utf8') : null));
r.send('x'); await r.wait(300); r.send('\x7f'); await r.wait(300); // any key clears the highlight
// triple click on the line
await r.wait(700);
for (let i = 0; i < 3; i++) { r.mouse('press', x + 2, y + 1); r.mouse('release', x + 2, y + 1); await r.wait(100); }
await r.wait(1200);
console.log('triple-click clipboard =', JSON.stringify(readFileSync('/private/tmp/jv-shim/clipboard.txt', 'utf8')));
// outside-the-project write: how does the question read?
r.send('x'); await r.wait(300); r.send('\x7f'); await r.wait(500);
r.send('Create a file called hello.txt in ~/Documents/Projects/test containing the word hi.'); await r.wait(300); r.send('\r');
await r.until((t) => /Always Allow|Allow/.test(t) && t.includes('?'), 90000, 'question');
console.log('\n--- the question on screen:'); r.screen().slice(14, 32).forEach((l) => console.log(l));
console.log('Heads up on screen:', /Heads up/i.test(r.text()), '| "undo" on screen:', /undo/i.test(r.text()));
r.send('n'); await r.wait(4000);
console.log('\n--- after Decline:'); r.screen().slice(18, 32).forEach((l) => console.log(l));
r.kill(); process.exit(0);
