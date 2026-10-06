// Plan first, scripted (fake-zai PLANTEST): switched on from Settings by a click, a write
// is refused, the plan is shown with buttons, Go ahead turns it off.
import { Rig } from './pty-rig.mjs';
import { existsSync, rmSync } from 'node:fs';
rmSync('/private/tmp/jv-plan-test.txt', { force: true });
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation();
await r.wait(1200);
r.mouse('press', 4, 31); r.mouse('release', 4, 31);
await r.until((t) => t.includes('SETTINGS'), 8000);
const at = r.screen().findIndex((l) => l.includes('Plan first'));
console.log('Plan first row on screen:', at >= 0);
r.mouse('press', 8, at + 1); r.mouse('release', 8, at + 1);
await r.until((t) => t.includes('Plan first is ON'), 8000, 'switched on');
console.log('bar shows plan first:', r.screen().some((l) => l.includes('plan first') && l.includes('Settings')));
r.send('PLANTEST please tidy'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Go ahead with this plan'), 20000, 'plan question');
console.log('refused write left no file:', !existsSync('/private/tmp/jv-plan-test.txt'));
console.log(r.screen().filter((l) => /plan first is on|The plan|Look at the invoices|Go ahead|Change the plan/.test(l)).map((l) => l.replace(/[│]/g, '').trim()).join('\n'));
r.send('1'); 
await r.until((t) => t.includes('Plan result'), 20000, 'result');
console.log('after Go ahead:', r.screen().find((l) => l.includes('Plan result'))?.replace(/[│▎]/g, '').trim().slice(0, 90));
console.log('bar still says plan first:', r.screen().some((l) => l.includes('plan first') && l.includes('glm')));
r.kill(); await r.wait(300); process.exit(0);
