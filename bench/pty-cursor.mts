import { Rig } from './pty-rig.mjs';
const r = new Rig();
await r.until((t) => t.includes('Just chat - no project'), 15000);
r.send('\r');
await r.until((t) => t.includes('Settings'), 15000, 'conversation');
await r.wait(1200);
// where is the inverse cell(s)?
const inv = () => {
  const b = r.term.buffer.active; const out: string[] = [];
  for (let y = 0; y < r.rows; y++) { const line = b.getLine(y); for (let x = 0; x < r.cols; x++) { const c = line.getCell(x); if (c && c.isInverse() && !(y === 30)) out.push(`(${x},${y})`); } }
  return out.join(' ') || 'none';
};
const state = (l: string) => console.log(l.padEnd(28), 'hardware cursor hidden:', r.term._core.coreService.isCursorHidden, ' inverse cells (excluding info bar):', inv());
state('empty box');
r.send('abc'); await r.wait(500); state('typed abc');
r.send('x'.repeat(120)); await r.wait(500); state('wrapped onto 2nd row');
r.send('\x1b[D\x1b[D'); await r.wait(500); state('cursor moved left twice');
r.kill(); process.exit(0);
