// Needs a clipboard shim first: /private/tmp/jv-shim/pbcopy = `#!/bin/sh` + `cat > /private/tmp/jv-shim/clipboard.txt` (chmod +x). Seed first: npx tsx scripts/seed-test-env.ts.
// A real-window test rig: runs Jeeves in a pseudo-terminal and reads the screen
// back through a terminal emulator (so text AND the cursor's real position are
// visible). Needs node-pty and @xterm/headless installed with --no-save.
// The clipboard program is replaced by a shim so a test never touches the real clipboard.
import * as pty from 'node-pty';
import xterm from '@xterm/headless';
const { Terminal } = xterm as any;

export class Rig {
  term: any;
  proc: pty.IPty;
  raw = '';
  constructor(public cols = 100, public rows = 32, env: Record<string, string> = {}) {
    this.term = new Terminal({ cols, rows, allowProposedApi: true });
    this.proc = pty.spawn('node', ['dist/index.js'], {
      name: 'xterm-256color', cols, rows, cwd: process.env.RIG_CWD ?? process.cwd(),
      env: { ...process.env, NODE_ENV: 'test', JEEVES_KEYCHAIN_SERVICE: 'jeeves-tests', PATH: `/private/tmp/jv-shim:${process.env.PATH}`, ...env } as any,
    });
    this.proc.onData((d) => { this.raw += d; this.term.write(d); });
  }
  screen(): string[] {
    const b = this.term.buffer.active; const out: string[] = [];
    for (let i = 0; i < this.rows; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
    return out;
  }
  text(): string { return this.screen().join('\n'); }
  cursor() { const b = this.term.buffer.active; return { x: b.cursorX, y: b.cursorY }; }
  send(s: string) { this.proc.write(s); }
  async wait(ms: number) { await new Promise((r) => setTimeout(r, ms)); }
  async until(test: (t: string) => boolean, ms = 30000, label = 'condition') {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (test(this.text())) return; await this.wait(150); }
    throw new Error(`timed out waiting for ${label}\n` + this.text());
  }
  // SGR mouse: 1-based column and row
  mouse(kind: 'press' | 'drag' | 'release' | 'up' | 'down', col: number, row: number) {
    const code = { press: '0;M', drag: '32;M', release: '0;m', up: '64;M', down: '65;M' }[kind];
    const [b, f] = code.split(';');
    this.send(`\x1b[<${b};${col};${row}${f}`);
  }
  kill() { try { this.proc.kill(); } catch {} }
}
