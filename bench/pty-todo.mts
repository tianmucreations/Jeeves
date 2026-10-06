// A scripted three-step job (fake-zai TODOTEST): the checklist must appear above the
// typing box, tick as steps finish, and go away when all are done.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation();
await r.wait(1200);
r.send('TODOTEST please tidy'); await r.wait(300); r.send('\r');
// THE ONE-LINE CHECKLIST (3 Oct): no bullet box any more - a single line
// naming the step in progress, above the typing box.
await r.until((t) => /Step 1 of 3.*Find the invoices/.test(t), 20000, 'checklist line shown');
console.log('--- step 1'); console.log(r.screen().filter((l) => /Find the invoices|Rename them|Make a summary/.test(l)).join('\n'));
await r.until((t) => /Step 2 of 3.*Rename them/.test(t), 20000, 'step 2');
console.log('--- step 2'); console.log(r.screen().filter((l) => /Find the invoices|Rename them|Make a summary/.test(l)).join('\n'));
await r.until((t) => t.includes('All three steps are done'), 20000, 'finished');
await r.wait(500);
console.log('--- finished: the checklist line is gone?', !/Step \d of \d/.test(r.text()));
console.log(r.screen().slice(-8).join('\n'));
r.kill(); await r.wait(300); process.exit(0);
