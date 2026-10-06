// The three steps, everything by mouse: a brand-new person clicks Ma'am, Just chat, then a provider (OpenAI),
// how to connect (the ChatGPT plan) and the sign-in button. No key press needed anywhere.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_KEYCHAIN_SERVICE: 'jeeves-fresh', JEEVES_NO_BROWSER: '1' });
const show = (t: string) => { console.log(`=== ${t}`); console.log(r.screen().filter((l) => l.trim()).join('\n')); };
await r.until((t) => t.includes('how shall I address you'), 15000);
r.mouse('press', 10, 3); r.mouse('release', 10, 3);
await r.until((t) => t.includes('Just chat, or choose a project folder'), 8000, 'step 1');
show('STEP 1 - FOLDER');
r.mouse('press', 10, 5); r.mouse('release', 10, 5);
await r.until((t) => t.includes('Choose a provider'), 8000, 'step 2');
show('STEP 2 - PROVIDER');
const at = r.screen().findIndex((l) => l.includes('OpenAI'));
r.mouse('press', 10, at + 1); r.mouse('release', 10, at + 1);
await r.until((t) => t.includes('How do you want to connect to OpenAI'), 8000, 'how to connect');
show('STEP 3 - HOW TO CONNECT');
r.mouse('press', 10, 4); r.mouse('release', 10, 4);
await r.until((t) => t.includes('Connect Jeeves to your ChatGPT plan'), 8000, 'chatgpt');
r.mouse('press', 15, 6); r.mouse('release', 15, 6);
await r.until((t) => t.includes('Signing in with ChatGPT'), 8000, 'waiting');
console.log('=== clicked through to the sign-in wait, by mouse only');
r.kill(); await r.wait(300); process.exit(0);
