import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat - no project folder'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
r.send('Say something.'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Paragraph 8'), 60000, 'answer');
await r.wait(45000);
for (let i = 0; i < 80; i++) { r.mouse('up', 30, 10); await r.wait(20); }
await r.wait(500);
console.log(r.screen().slice(1, 4).join('\n'));
for (let i = 0; i < 30; i++) { r.send('\x1b[5~'); await r.wait(60); }
await r.wait(500);
console.log('--- after PageUp x30');
console.log(r.screen().slice(1, 4).join('\n'));
r.kill(); await r.wait(300); process.exit(0);
