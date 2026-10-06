// Settings for someone already set up: the three steps at the top, each opens its list, everything by mouse.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
const show = (t: string) => { console.log(`=== ${t}`); console.log(r.screen().filter((l) => l.trim()).join('\n')); };
await r.until((t) => t.includes('Just chat, or choose a project folder'), 15000);
r.mouse('press', 10, 5); r.mouse('release', 10, 5);
await r.until((t) => t.includes('Settings'), 15000); await r.wait(1000);
async function open() {
  r.mouse('press', 4, 31); r.mouse('release', 4, 31);
  await r.until((t) => t.includes('SETTINGS'), 8000);
}
await open();
show('SETTINGS');
let at = r.screen().findIndex((l) => l.includes('3. Model'));
r.mouse('press', 8, at + 1); r.mouse('release', 8, at + 1);
await r.until((t) => t.includes('Choose a model'), 8000, 'model list'); await r.wait(400);
show('STEP 3 - MODEL (Z.ai)');
const row = r.screen().findIndex((l, i) => i > 3 && /GLM-5\.2/.test(l));
console.log('row for GLM-5.2:', row);
r.mouse('press', 10, row + 1); r.mouse('release', 10, row + 1);
await r.wait(1500);
console.log('bar model now:', r.screen().find((l) => l.includes('Settings') && l.includes('Picture'))?.replace(/│/g, '').trim().slice(0, 60));
await open();
at = r.screen().findIndex((l) => l.includes('2. Provider'));
r.mouse('press', 8, at + 1); r.mouse('release', 8, at + 1);
await r.until((t) => t.includes('Choose a provider'), 8000, 'providers');
show('STEP 2 - PROVIDER (with ticks)');
r.send('\x1b'); await r.wait(600);
await open();
at = r.screen().findIndex((l) => l.includes('1. Project folder'));
r.mouse('press', 8, at + 1); r.mouse('release', 8, at + 1);
await r.until((t) => t.includes('Change folder - or Just chat'), 8000, 'folders');
show('STEP 1 - FOLDER');
r.kill(); await r.wait(300); process.exit(0);
