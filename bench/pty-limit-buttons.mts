// The spending-limit screen: a cursor in the field, Back and Save buttons both work, Esc closes.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation(); await r.wait(1000);
const click = (c: number, row: number) => { r.mouse('press', c, row); r.mouse('release', c, row); };
const home = () => /Settings\s+Picture/.test(r.text()) && r.text().includes('╰');
const openLimit = async () => { r.send('/settings'); await r.wait(200); r.send('\r'); await r.wait(1000);
  const i = r.screen().findIndex((l) => l.includes('Daily spending limit')); click(6, i + 1); await r.wait(1200); };
await openLimit(); console.log('screen:', r.screen().find((l) => l.trim()));
let bi = r.screen().findIndex((l) => l.includes('← Back')); click(4, bi + 1); await r.wait(1000);
console.log('Back click ->', r.screen().find((l) => l.trim())?.trim().slice(0, 40));
r.send('\x1b'); await r.wait(900); console.log('Esc home:', home());
await openLimit(); r.send('7'); await r.wait(300);
console.log('typed 7 shows:', r.screen().some((l) => /: 7/.test(l)));
bi = r.screen().findIndex((l) => l.includes(' Save ')); click(14, bi + 1); await r.wait(1200);
console.log('Save click -> home:', home(), '| notice:', r.text().match(/limit[^\n│]*/i)?.[0]?.slice(0, 60));
await openLimit(); r.send('\x1b'); await r.wait(1000); console.log('Esc from limit home:', home());
r.kill(); await r.wait(300); process.exit(0);
