// Drag-select past the top edge of a long answer: the view must keep scrolling and the
// copied text must reach far beyond one screenful. Then the Settings list and the
// All providers list. Needs the clipboard shim (see pty-toast.mts) and fake-zai.
import { Rig } from './pty-rig.mjs';
import { readFileSync } from 'node:fs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat - no project folder'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
r.send('Say something.'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Paragraph 8'), 60000, 'answer');
await r.wait(3000);
// Start at the bottom of the conversation, drag above its top edge and hold.
await r.wait(6000);
r.mouse('press', 8, 26); r.mouse('drag', 30, 20); r.mouse('drag', 30, 1);
await r.wait(2500);
console.log('during hold, top rows:', r.screen().slice(1,4).join(' | ').slice(0,200));
r.mouse('release', 30, 1);
await r.wait(800);
let copied = ''; try { copied = readFileSync('/private/tmp/jv-shim/clipboard.txt', 'utf8'); } catch {}
console.log('copied lines:', copied.split('\n').length, '| has Paragraph 1:', copied.includes('Paragraph 1.'), '| has Paragraph 8:', copied.includes('Paragraph 8'));
// Settings: the AI is one row; it opens the full provider list, which has "All providers".
r.send('\x1b'); await r.wait(300);
r.mouse('press', 4, 31); r.mouse('release', 4, 31);
await r.until((t) => t.includes('AI provider and model'), 8000, 'settings list').catch(() => console.log(r.text()));
console.log(r.screen().filter((l) => /AI provider and model|Project folder/.test(l)).map((l) => l.replace(/│/g, '').trim()).join('\n'));
let at = r.screen().findIndex((l) => l.includes('AI provider and model'));
r.mouse('press', 10, at + 1); r.mouse('release', 10, at + 1);
await r.until((t) => t.includes('Choose an AI service'), 8000, 'provider list');
for (let i = 0; i < 9; i++) { r.send('\x1b[B'); await r.wait(120); }
console.log(r.screen().filter((l) => l.includes('All providers')).map((l) => l.trim()).join('\n'));
r.send('\r');
await r.until((t) => t.includes('All providers - type to search'), 8000, 'all providers');
r.send('deep'); await r.wait(500);
console.log(r.screen().slice(0, 4).join('\n'));
r.kill(); await r.wait(500); process.exit(0);
