// A scripted three-step job (fake-zai TODOTEST): the checklist must appear above the
// typing box, tick as steps finish, and go away when all are done.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat - no project folder'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
r.send('TODOTEST please tidy'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Find the invoices'), 20000, 'list shown');
console.log('--- step 1'); console.log(r.screen().filter((l) => /Find the invoices|Rename them|Make a summary/.test(l)).join('\n'));
await r.until((t) => /✓ Find the invoices/.test(t), 20000, 'step 2');
console.log('--- step 2'); console.log(r.screen().filter((l) => /Find the invoices|Rename them|Make a summary/.test(l)).join('\n'));
await r.until((t) => t.includes('All three steps are done'), 20000, 'finished');
await r.wait(500);
console.log('--- finished: list still shown?', /○ |● /.test(r.text()) || /✓ Make a summary/.test(r.text()));
console.log(r.screen().slice(-8).join('\n'));
r.kill(); await r.wait(300); process.exit(0);
