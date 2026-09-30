// A model that cannot see pictures (JEEVES_TEST_BLIND_MODEL): plain words and two buttons; "Send
// without the picture" goes on with the words, "Choose a model" opens Settings and sends nothing.
import { Rig } from './pty-rig.mjs';
import { writeFileSync } from 'node:fs';
writeFileSync('/private/tmp/jv-blind.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));
async function run(choice: 1 | 2) {
  const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123', JEEVES_TEST_BLIND_MODEL: 'glm-5.3-flash' });
  await r.until((t) => t.includes('Just chat - no project folder'), 15000); r.send('\r');
  await r.until((t) => t.includes('Settings'), 15000); await r.wait(1200);
  r.send('what is this? '); await r.wait(200);
  r.send('\x1b[200~/private/tmp/jv-blind.png\x1b[201~'); await r.wait(1200);
  r.send('\r');
  await r.until((t) => t.includes("can't see pictures"), 20000, 'question');
  console.log(`--- choice ${choice}:`, r.screen().filter((l) => /can't see|Choose a model|Send without/.test(l)).map((l) => l.replace(/│/g, '').trim()).join(' | '));
  r.send(String(choice)); await r.wait(2500);
  if (choice === 2) { await r.until((t) => t.includes('Paragraph 1'), 30000, 'answer'); console.log('answer arrived (words only):', true); }
  else console.log('settings opened, nothing sent:', r.text().includes('SETTINGS'));
  r.kill(); await r.wait(300);
}
await run(2); await run(1);
process.exit(0);
