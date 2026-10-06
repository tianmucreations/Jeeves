// Drop a picture file onto the window (its address arrives as a paste): it becomes [Image 1],
// and the message that goes to the model carries the picture. Needs fake-zai with FAKE_LOG.
import { Rig } from './pty-rig.mjs';
import { writeFileSync, readFileSync, rmSync } from 'node:fs';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
writeFileSync('/private/tmp/jv-pic test.png', PNG);
rmSync('/private/tmp/jv-fake.log', { force: true });
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat - no project folder'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
r.send('what is in this? '); await r.wait(200);
r.send('\x1b[200~/private/tmp/jv-pic\\ test.png\x1b[201~'); await r.wait(1500);
console.log('marker in the box:', r.text().includes('[Image 1]'), '| toast:', r.text().includes('Picture added'));
r.send('\r');
await r.until((t) => t.includes('Paragraph 2'), 30000, 'answer');
const log = readFileSync('/private/tmp/jv-fake.log', 'utf8').trim().split('\n').pop();
console.log('what the model was sent:', log);
r.kill(); await r.wait(300); process.exit(0);
