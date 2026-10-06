// Two jobs that each write a file (fake-zai REWINDTEST), then Settings, Go back to an earlier point:
// the folder goes back to before the FIRST job. Runs inside a throwaway project folder.
import { Rig } from './pty-rig.mjs';
import { mkdirSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
const proj = '/private/tmp/jv-rewind/proj';
rmSync('/private/tmp/jv-rewind', { recursive: true, force: true });
mkdirSync(proj, { recursive: true });
const configFile = `${homedir()}/Library/Preferences/jeeves-tests-nodejs/config.json`;
const config = JSON.parse(readFileSync(configFile, 'utf8'));
config.projects = [proj];
writeFileSync(configFile, JSON.stringify(config));
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123', JEEVES_CHECKPOINTS_DIR: '/private/tmp/jv-rewind/store' });
await r.until((t) => t.includes('Recent project folders'), 15000);
r.send('\x1b[B'); await r.wait(200); r.send('\r');
await r.until((t) => t.includes('Settings'), 15000); await r.wait(1200);
async function job(file: string, words: string) {
  r.send(`REWINDTEST ${file} ${words}`); await r.wait(300); r.send('\r');
  await r.until((t) => t.includes('Allow'), 20000, 'the question');
  r.send('y');
  await r.until((t) => t.includes(`Done with ${file}`), 20000, 'done');
  await r.wait(600);
}
await job('a.txt', 'first');
await job('b.txt', 'second');
console.log('after two jobs:', existsSync(`${proj}/a.txt`), existsSync(`${proj}/b.txt`));
r.mouse('press', 4, 31); r.mouse('release', 4, 31);
await r.until((t) => t.includes('SETTINGS'), 8000);
const at = r.screen().findIndex((l) => l.includes('Go back to an earlier point'));
console.log('button in Settings:', at >= 0);
r.mouse('press', 8, at + 1); r.mouse('release', 8, at + 1);
await r.until((t) => t.includes('GO BACK TO AN EARLIER POINT'), 8000);
console.log(r.screen().filter((l) => l.includes('Before "')).map((l) => l.replace(/│/g, '').trim()).join(' | '));
// The list is newest first: the second row is the FIRST job.
const rows = r.screen().map((l, i) => (l.includes('Before "REWINDTEST a.txt') ? i : -1)).filter((i) => i >= 0);
r.mouse('press', 10, rows[0] + 1); r.mouse('release', 10, rows[0] + 1); await r.wait(300);
r.mouse('press', 4, 32); r.mouse('release', 4, 32); await r.wait(300);
console.log('asked to confirm:', r.text().includes('click Go back again'));
r.mouse('press', 4, 32); r.mouse('release', 4, 32);
await r.until((t) => t.includes('Gone back'), 10000, 'gone back');
console.log(r.screen().find((l) => l.includes('Gone back'))?.replace(/[│]/g, '').trim().slice(0, 100));
console.log('files now: a.txt', existsSync(`${proj}/a.txt`), '| b.txt', existsSync(`${proj}/b.txt`));
r.kill(); await r.wait(300); process.exit(0);
