import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(800);
r.raw = '';
console.log('--- resize 100x32 -> 120x45');
r.proc.resize(120, 45); r.term.resize(120, 45); r.cols = 120; r.rows = 45;
await r.wait(700);
const chunk = r.raw;
console.log('raw bytes after resize:', chunk.length);
console.log('contains 2J:', chunk.includes('\x1b[2J'), '| contains CSI H at start:', /\x1b\[H/.test(chunk));
console.log('contains 45-row layout? bottom border count:', (chunk.match(/╰/g) ?? []).length);
// what does the emulator show at row 44 (last)?
console.log('screen row 45:', JSON.stringify(r.screen()[44]?.slice(0, 60)));
console.log('screen row 31:', JSON.stringify(r.screen()[31]?.slice(0, 60)));
r.kill(); await r.wait(500); process.exit(0);
