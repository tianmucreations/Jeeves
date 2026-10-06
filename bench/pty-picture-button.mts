// The Picture button in the info bar: one click, the (pretend) chooser answers, and the picture
// joins the message as [Image 1]. NODE_ENV=test lets JEEVES_PICKER_FILE stand in for the real window.
import { Rig } from './pty-rig.mjs';
import { writeFileSync } from 'node:fs';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
writeFileSync('/private/tmp/jv-chosen.png', PNG);
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123', JEEVES_PICKER_FILE: '/private/tmp/jv-chosen.png' });
await r.bootConversation();
await r.wait(1200);
console.log('bar:', r.screen().find((l) => l.includes('Settings') && l.includes('Picture'))?.replace(/[│]/g, '').trim().slice(0, 60));
console.log('greeting shown:', r.text().includes('What can I do for you'));
r.mouse('press', 14, 31); r.mouse('release', 14, 31);
await r.until((t) => t.includes('[Image 1]'), 8000, 'picture added');
console.log('picture joined the message:', r.text().includes('[Image 1]'));
r.kill(); await r.wait(300); process.exit(0);
