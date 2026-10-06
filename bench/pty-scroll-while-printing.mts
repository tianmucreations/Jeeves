// While an answer is printing: typing shows at once, the window scrolls back (wheel + PageUp) and holds its place,
// the typing area and bar never leave, and typing brings the view back to the live end.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 30, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.bootConversation(); await r.wait(800);
r.send('write me a very long story'); await r.wait(500); r.send('\r');
await r.wait(7000);
const S = () => r.screen();
const intact = () => { const s = S(); return s[0].startsWith('╭') && s[s.length - 1].startsWith('╰') && /Settings\s+Picture/.test(s[s.length - 2]); };
const inputRow = () => S()[S().length - 4];
r.send('QQ'); await r.wait(500);
console.log('typing mid-print shows at once:', inputRow().includes('QQ'), '| box intact:', intact());
r.send('\x7f\x7f'); await r.wait(300);
r.mouse('up', 40, 10); r.mouse('up', 40, 10); r.mouse('up', 40, 10); await r.wait(600);
const a = S().slice(1, 24).join('\n');
console.log('wheel moved the view back, hint shown:', inputRow().includes('reading history'), '| box intact:', intact());
await r.wait(2500);
const b = S().slice(1, 24).join('\n');
console.log('view held its place while text kept arriving:', a === b, '| box intact:', intact());
r.send('PgUp'); r.send('\x1b[5~'); await r.wait(500);
console.log('PageUp moves further, box intact:', intact());
r.send('Z'); await r.wait(600);
console.log('typing returns to live end:', inputRow().includes('Z') && !inputRow().includes('reading history'), '| box intact:', intact());
await r.wait(25000);
console.log('finished, box intact:', intact(), '| input still works:', (r.send('Y'), await r.wait(500), inputRow().includes('Y')));
r.kill(); await r.wait(300); process.exit(0);
