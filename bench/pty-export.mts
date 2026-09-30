// A short chat in a throwaway folder, then Settings: Copy last answer (into the shim clipboard) and
// Save conversation as a document (a .txt in the folder). Start fake-zai with FAKE_PARAS=3 FAKE_MS=5.
import { Rig } from './pty-rig.mjs';
import { mkdirSync, rmSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
const proj = '/private/tmp/jv-export/proj';
rmSync('/private/tmp/jv-export', { recursive: true, force: true });
mkdirSync(proj, { recursive: true });
rmSync('/private/tmp/jv-shim/clipboard.txt', { force: true });
const configFile = `${homedir()}/Library/Preferences/jeeves-tests-nodejs/config.json`;
const config = JSON.parse(readFileSync(configFile, 'utf8'));
config.projects = [proj];
writeFileSync(configFile, JSON.stringify(config));
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Recent project folders'), 15000);
r.send('\x1b[B'); await r.wait(200); r.send('\r');
await r.until((t) => t.includes('Settings'), 15000); await r.wait(1200);
r.send('Tell me about Spain please'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Paragraph 3'), 30000, 'answer'); await r.wait(2500);
async function click(label: string) {
  r.mouse('press', 4, 31); r.mouse('release', 4, 31);
  await r.until((t) => t.includes('SETTINGS'), 8000);
  const at = r.screen().findIndex((l) => l.includes(label));
  if (at < 0) throw new Error(`no button ${label}\n${r.text()}`);
  r.mouse('press', 8, at + 1); r.mouse('release', 8, at + 1);
  await r.wait(1200);
}
await click('Copy last answer');
const copied = readFileSync('/private/tmp/jv-shim/clipboard.txt', 'utf8');
console.log('copied the last answer:', copied.includes('Paragraph 3') || copied.includes('Paragraph 2'), '| toast:', r.text().includes('Copied to clipboard'), '| starts:', JSON.stringify(copied.slice(0, 30)));
await click('Save conversation as a document');
console.log('notice:', r.screen().find((l) => l.includes('Saved as'))?.replace(/[│]/g, '').trim().slice(0, 110));
const files = readdirSync(proj);
console.log('files in the folder:', files);
console.log('file starts:', JSON.stringify(readFileSync(`${proj}/${files[0]}`, 'utf8').slice(0, 120)));
r.kill(); await r.wait(300); process.exit(0);
