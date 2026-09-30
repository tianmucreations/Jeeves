// A conversation on the (pretend) ChatGPT plan: checks what Jeeves sends and that the answer arrives.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_CHATGPT_ENDPOINT: 'http://127.0.0.1:4124/codex' });
await r.until((t) => t.includes('Just chat - no project folder'), 15000); r.send('\r');
await r.until((t) => t.includes('Settings'), 15000); await r.wait(1200);
console.log('bar model:', r.screen().find((l) => l.includes('Settings') && l.includes('gpt'))?.replace(/│/g, '').trim().slice(0, 60));
r.send('Say hello please'); await r.wait(300); r.send('\r');
await r.until((t) => t.includes('Hello from the pretend ChatGPT plan') || t.includes('refused') || t.includes('went wrong'), 30000, 'answer');
console.log(r.screen().filter((l) => /Hello from|refused|wrong|Say hello/.test(l)).map((l) => l.replace(/[│▎]/g, '').trim()).join('\n'));
r.kill(); await r.wait(300); process.exit(0);
