// While an answer prints: letters typed show at once in the typing area, and the typing area and bar stay at the bottom.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 30, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation(); await r.wait(800);
r.send('write me a very long story'); await r.wait(500); r.send('\r');
await r.wait(5000);
const S = () => r.screen();
const bar = () => S().findIndex((l) => /Settings\s+Picture/.test(l));
const inputRow = () => S()[bar() - 2];
console.log('answer is printing, words on screen:', r.text().split(/\s+/).length);
r.send('QQ'); await r.wait(500);
console.log('typing shows at once:', inputRow().includes('QQ'));
console.log('typing area has a divider above and below:', S()[bar() - 1].startsWith('─') && S()[bar() - 3].startsWith('─'));
console.log('history above it:', r.history().length, 'rows in the terminal scrollback');
r.kill(); await r.wait(300); process.exit(0);
