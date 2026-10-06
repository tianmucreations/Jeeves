// A brand-new person in the terminal: click Ma'am, pick Just chat, click "Yes, set one up".
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_KEYCHAIN_SERVICE: 'jeeves-fresh' });
const show = (t: string) => { console.log(`=== ${t}`); console.log(r.screen().filter((l) => l.trim()).join('\n')); };
await r.until((t) => t.includes('how shall I address you'), 15000);
show('1');
r.mouse('press', 10, 3); r.mouse('release', 10, 3);
await r.until((t) => t.includes('Just chat, or choose a project folder'), 8000, 'folder screen');
r.send('\r');
await r.until((t) => t.includes('Jeeves needs an AI service'), 8000, 'ask screen');
show('2');
r.mouse('press', 5, 6); r.mouse('release', 5, 6);
await r.until((t) => t.includes('Which AI service'), 8000, 'list screen');
show('3');
r.kill(); await r.wait(300); process.exit(0);
