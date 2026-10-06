// A scripted question (fake-zai QUESTIONTEST): buttons appear above the typing box; a
// click, a number, or typed words each answer it.
import { Rig } from './pty-rig.mjs';
async function run(how: 'click' | 'number' | 'typed' | 'enter') {
  const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
  await r.until((t) => t.includes('Just chat - no project folder'), 15000);
  r.send('\r');
  await r.until((t) => t.includes('Settings'), 15000, 'conversation');
  await r.wait(1200);
  r.send('QUESTIONTEST please'); await r.wait(300); r.send('\r');
  await r.until((t) => t.includes('Which folder should I put'), 20000, 'question');
  if (how === 'click') {
    const row = r.screen().findIndex((l) => l.includes('2  Desktop'));
    r.mouse('press', 10, row + 1); r.mouse('release', 10, row + 1);
  } else if (how === 'number') r.send('3');
  else if (how === 'enter') { r.send('\x1b[B'); await r.wait(200); r.send('\r'); }
  else { r.send('somewhere else entirely'); await r.wait(300); r.send('\r'); }
  await r.until((t) => t.includes('You picked'), 20000, 'answer');
  const line = r.screen().find((l) => l.includes('You picked')) ?? '';
  console.log(how.padEnd(7), '->', line.replace(/[│▎]/g, '').trim().slice(0, 80));
  console.log('        panel gone:', !r.text().includes('press its number'));
  r.kill(); await r.wait(300);
}
for (const how of ['click', 'number', 'enter', 'typed'] as const) await run(how);
process.exit(0);
