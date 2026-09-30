// The ChatGPT sign-in screens, without a real account: reach them from the first-run list, see the
// waiting screen and its address, send a wrong answer back to the sign-in door, and see the plain message.
import { Rig } from './pty-rig.mjs';
const r = new Rig(100, 32, { JEEVES_KEYCHAIN_SERVICE: 'jeeves-fresh', JEEVES_NO_BROWSER: '1' });
const show = (t: string) => { console.log(`=== ${t}`); console.log(r.screen().filter((l) => l.trim()).join('\n')); };
await r.until((t) => t.includes('how shall I address you'), 15000);
r.mouse('press', 10, 3); r.mouse('release', 10, 3);
await r.until((t) => t.includes('Just chat, or choose a project folder'), 8000); r.send('\r');
await r.until((t) => t.includes('Jeeves needs an AI service'), 8000);
r.send('\r'); await r.until((t) => t.includes('Which AI service'), 8000);
show('1. THE LIST');
for (let i = 0; i < 3; i++) { r.send('\x1b[B'); await r.wait(150); }
r.send('\r'); await r.until((t) => t.includes('How do you want to connect to OpenAI'), 8000);
show('2. HOW TO CONNECT TO OPENAI');
r.send('1'); await r.until((t) => t.includes('Connect Jeeves to your ChatGPT plan'), 8000);
show('2b. CHATGPT SIGN-IN');
r.send('\r'); await r.until((t) => t.includes('Signing in with ChatGPT'), 8000);
await r.wait(500);
const text = r.screen().join('');
const address = text.match(/https:\/\/auth\.openai\.com[^\s│]+/)?.[0] ?? '';
show('3. WAITING');
const state = new URL(address.replace(/\s/g, '')).searchParams.get('state');
console.log('state found in the address:', Boolean(state));
await fetch(`http://localhost:1455/auth/callback?code=NOTREAL&state=${state}`).then((x) => x.text()).catch((e) => console.log('callback failed', String(e)));
await r.until((t) => t.includes("didn't complete the sign-in"), 15000, 'refused message');
show('4. AFTER A REFUSED SIGN-IN');
r.kill(); await r.wait(300); process.exit(0);
