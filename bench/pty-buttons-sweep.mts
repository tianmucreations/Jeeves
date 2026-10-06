// Click-and-Esc proof for the connect screens reached from the provider list.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation(); await r.wait(1000);
const first = () => r.screen().find((l) => l.trim())?.trim().slice(0, 60);
const click = (c: number, row: number) => { r.mouse('press', c, row); r.mouse('release', c, row); };
const open = async (label: string) => { r.send('/model'); await r.wait(200); r.send('\r'); await r.wait(1300);
  const i = r.screen().findIndex((l) => l.includes(label)); click(6, i + 1); await r.wait(1300); };
const out: string[] = [];
for (const label of ['OpenRouter', 'Anthropic', 'OpenAI', 'Other provider']) {
  await open(label);
  out.push(`${label}: screen="${first()}"`);
  const lastRow = r.screen().findIndex((l, i) => i >= 20 && /Back/.test(l)) ;
  const hasBack = r.text().includes('Back');
  // click Back (row = the row containing '← Back')
  const bi = r.screen().findIndex((l) => l.includes('← Back'));
  if (bi >= 0) { click(4, bi + 1); await r.wait(1000); out.push(`  clicked Back → "${first()}"`); }
  else out.push('  (no Back button on screen)');
  // then Esc out to the conversation
  for (let k = 0; k < 4 && !/Settings\s+Picture/.test(r.text()); k++) { r.send('\x1b'); await r.wait(900); }
  out.push('  home: ' + /Settings\s+Picture/.test(r.text()));
}
console.log(out.join('\n'));
r.kill(); await r.wait(300); process.exit(0);
