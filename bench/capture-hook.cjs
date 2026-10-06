const fs = require('node:fs');
const target = process.env.JEEVES_CAPTURE;
if (target) {
  const out = fs.createWriteStream(target, { flags: 'a' });
  const orig = process.stdout.write.bind(process.stdout);
  process.stdout.write = (chunk, ...rest) => { out.write(typeof chunk === 'string' ? chunk : Buffer.from(chunk)); return orig(chunk, ...rest); };
  process.on('SIGWINCH', () => { out.write(`\n[HOOK winsize now ${process.stdout.columns}x${process.stdout.rows}]\n`); });
}
