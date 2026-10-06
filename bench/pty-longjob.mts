// THE 30-STEP JOB (2 Oct): a long job must run to completion with no stop, no
// "type: continue", and no `cd` lines on screen - and a directory change in the
// middle must carry over to the commands after it.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(800);
r.send('LONGJOB please work through all thirty steps');
await r.wait(300); r.send('\r');
await r.until((t) => /All 30 steps are done/.test(t), 120000, 'the job to finish');
await r.wait(1200);

const screen = r.text();
let ok = true;
const must = (condition: boolean, label: string) => { console.log(`${condition ? 'ok  ' : 'FAIL'} ${label}`); if (!condition) ok = false; };
must(/All 30 steps are done/.test(screen), 'the job finished with its completion line on screen');
must(!/type:? (continue|to carry on)/i.test(screen), 'no "type: continue" anywhere on screen');
must(!/carry on,? type/i.test(screen), 'no "to carry on, type" anywhere on screen');
must(!/Ran cd /i.test(screen), 'no "Ran cd" lines on screen (directory changes are silent)');
must(!/steps allowed for one go/i.test(screen), 'no step-cap wrap-up message');
must(/\/private\/tmp/.test(screen), 'the last command (pwd) ran in the directory the job cd-ed into');
console.log(ok ? 'PROVEN' : 'BROKEN');
r.kill(); await r.wait(800); process.exit(ok ? 0 : 1);
