// Feeds mouse-wheel codes to Jeeves in awkward pieces (whole, split at every byte,
// bursts) and looks for any of it turning up as typed text in the box.
import { Rig } from './pty-rig.mjs';
const r = new Rig();
await r.until((t) => t.includes('Just chat - no project'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1500);
const seq = '\x1b[<65;36;13M';
const inputRow = () => r.screen()[28];
let leaks = 0;
const check = (label: string) => { const row = inputRow(); if (/[<;\d]M|\[</.test(row)) { leaks++; console.log('LEAK', label, JSON.stringify(row.trim())); } };
// 1. every split point, with a pause between the pieces
for (let cut = 1; cut < seq.length; cut++) {
  r.send(seq.slice(0, cut)); await r.wait(60); r.send(seq.slice(cut)); await r.wait(120); check(`split@${cut} pause 60ms`);
}
// 2. every split point, pause longer than Ink's flush timer
for (let cut = 1; cut < seq.length; cut++) {
  r.send(seq.slice(0, cut)); await r.wait(400); r.send(seq.slice(cut)); await r.wait(150); check(`split@${cut} pause 400ms`);
}
// 3. bursts in one write
r.send(seq.repeat(30)); await r.wait(300); check('burst of 30');
// 4. bursts cut at odd places
const big = seq.repeat(20);
for (const size of [1, 3, 7, 11]) { for (let i = 0; i < big.length; i += size) r.send(big.slice(i, i + size)); await r.wait(400); check(`chunks of ${size}`); }
console.log('leaks:', leaks, '| input row now:', JSON.stringify(inputRow().trim()));
r.kill(); process.exit(0);
