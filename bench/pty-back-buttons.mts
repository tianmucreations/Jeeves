// Every screen has a clickable Back, and mouse mode is on for each (the rig refuses to click otherwise).
// Path: Just chat -> provider list -> Z.ai key screen -> Back -> OpenAI -> Back -> Anthropic -> Back -> All providers -> Back.
import fs from 'node:fs';
import os from 'node:os';
import { Rig } from './pty-rig.mjs';
// A brand-new person: no saved address, so the first question shows.
const configFile = `${os.homedir()}/Library/Preferences/jeeves-tests-nodejs/config.json`;
const saved = JSON.parse(fs.readFileSync(configFile, 'utf8'));
delete saved.address;
fs.writeFileSync(configFile, JSON.stringify(saved, null, '\t'));
const ROWS = 32;
const r = new Rig(100, ROWS, { JEEVES_KEYCHAIN_SERVICE: 'jeeves-fresh', JEEVES_NO_BROWSER: '1' });
const click = (col: number, row: number) => { r.mouse('press', col, row); r.mouse('release', col, row); };
const rowOf = (word: string) => r.screen().findIndex((l) => l.includes(word)) + 1;
const fail = (m: string) => { console.log('FAIL', m); console.log(r.screen().filter((l) => l.trim()).join('\n')); r.kill(); process.exit(1); };
const expect = async (text: string, label: string) => { try { await r.until((t) => t.includes(text), 6000, label); } catch { fail(label); } };
await r.until((t) => t.includes('how shall I address you'), 15000);
click(10, 3);
await expect('Just chat, or choose a project folder', 'folder');
click(10, 5);
await expect('Choose a provider', 'providers');
for (const [name, next] of [['Z.ai', 'Paste your Z.ai API key'], ['OpenAI', 'How do you want to connect to OpenAI'], ['Anthropic', 'Paste your Anthropic API key']] as const) {
  click(10, rowOf(name));
  await expect(next, name);
  const bottom = (name === 'OpenAI' ? r.screen()[9] : r.screen()[ROWS - 1]) ?? '';
  if (!bottom.includes('Back')) fail(`${name}: no Back on the last row: "${bottom}"`);
  if (name !== 'OpenAI') { if (!bottom.includes('Save') || !bottom.includes('Open the page')) fail(`${name}: buttons missing: "${bottom}"`); }
  click(4, name === 'OpenAI' ? 10 : ROWS);
  await expect('Choose a provider', `${name} back`);
}
click(10, rowOf('All providers'));
await expect('Search:', 'all providers');
click(4, ROWS);
await expect('Choose a provider', 'all providers back');
console.log('PASS: every screen went back by click');
r.kill(); await r.wait(300); process.exit(0);
