// Jeeves is asked to remember something (fake-zai MEMTEST); it says so; a NEW conversation's rulebook then
// carries the note; Settings, What I remember, lists it and Delete removes it.
import { Rig } from './pty-rig.mjs';
import { readFileSync, rmSync } from 'node:fs';
rmSync('/private/tmp/jv-fake.log', { force: true });
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat - no project folder'), 15000); r.send('\r');
await r.until((t) => t.includes('Settings'), 15000); await r.wait(1200);
r.send('MEMTEST I prefer tea over coffee'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Noted, I will remember that'), 30000, 'answer');
console.log('record line:', r.screen().find((l) => l.includes('Remembered'))?.replace(/[│]/g, '').trim());
// A brand-new conversation: does the rulebook now carry the note?
r.mouse('press', 4, 31); r.mouse('release', 4, 31);
await r.until((t) => t.includes('SETTINGS'), 8000);
let at = r.screen().findIndex((l) => l.includes('New conversation'));
r.mouse('press', 8, at + 1); r.mouse('release', 8, at + 1); await r.wait(800);
r.send('hello again'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Paragraph 1'), 30000, 'second answer');
const lines = readFileSync('/private/tmp/jv-fake.log', 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const last = lines.filter((l) => 'rulebookHasNote' in l).pop();
console.log('new conversation rulebook has the note:', last?.rulebookHasNote);
r.mouse('press', 4, 31); r.mouse('release', 4, 31);
await r.until((t) => t.includes('SETTINGS'), 8000);
at = r.screen().findIndex((l) => l.includes('What I remember'));
r.mouse('press', 8, at + 1); r.mouse('release', 8, at + 1);
await r.until((t) => t.includes('WHAT I REMEMBER'), 8000);
console.log('list shows:', r.screen().find((l) => l.includes('tea over coffee'))?.replace(/[│]/g, '').trim());
r.mouse('press', 4, 32); r.mouse('release', 4, 32); await r.wait(400);
r.mouse('press', 4, 32); r.mouse('release', 4, 32); await r.wait(600);
console.log('after Delete twice, still listed:', r.text().includes('tea over coffee'));
r.kill(); await r.wait(300); process.exit(0);
