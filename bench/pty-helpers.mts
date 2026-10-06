// Two helpers sent at once (fake-zai HELPERTEST): both lines show while they work, both reports come back.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat - no project folder'), 15000); r.send('\r');
await r.until((t) => t.includes('Settings'), 15000); await r.wait(1200);
r.send('HELPERTEST check both folders'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Helper') || t.includes('helper'), 20000, 'helper lines');
console.log('while working:', r.screen().filter((l) => /Helper/.test(l)).map((l) => l.replace(/[│▎]/g, '').trim().slice(0, 80)).join(' | '));
await r.until((t) => t.includes('Both helpers reported'), 30000, 'answer');
console.log('answer:', r.screen().find((l) => l.includes('Both helpers reported'))?.replace(/[│▎]/g, '').trim().slice(0, 140));
console.log('record lines:', r.screen().filter((l) => /Helper looked into/.test(l)).length);
r.kill(); await r.wait(300); process.exit(0);
