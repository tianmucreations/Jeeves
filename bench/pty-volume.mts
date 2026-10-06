// How much does Jeeves write to the terminal while an answer streams? Counts frames
// and bytes (a flood of big frames is what makes a real terminal lag and scrolling
// feel jumpy). Uses the pretend service, so it costs nothing.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_ZAI_BASE_URL: 'http://127.0.0.1:4123' });
await r.until((t) => t.includes('Just chat - no project'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
r.send('Write about 900 words on Spain.'); await r.wait(300);
r.raw = '';
const t0 = Date.now();
r.send('\r');
await r.until((t) => t.includes('▎'), 30000, 'answer');
const started = Date.now();
await r.wait(15000);
const bytes = r.raw.length;
const frames = (r.raw.match(/\x1b\[\?2026h/g) ?? []).length;
console.log(`in 15 s of streaming: ${frames} frames, ${(bytes / 1024).toFixed(0)} KB total, ${(bytes / Math.max(1, frames) / 1024).toFixed(1)} KB per frame, ${(bytes / 15 / 1024).toFixed(0)} KB/s`);
r.kill(); process.exit(0);
