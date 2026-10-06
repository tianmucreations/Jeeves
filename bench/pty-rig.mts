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
    // A real terminal answers "where is the cursor?" - so does this one.
    this.term.onData((d: string) => { try { this.proc.write(d); } catch {} });
  }
  screen(): string[] {
    const b = this.term.buffer.active; const out: string[] = [];
    for (let i = 0; i < this.rows; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
    return out;
  }
  text(): string { return this.screen().join('\n'); }
  // Boot to the conversation, walking WHATEVER launch state the test settings
  // are in (they are rewritten by the vitest suite - the standing gotcha):
  // the address question, the folder picker, or straight in. Every script used
  // to hand-roll this and half of them hung on one variant.
  async bootConversation(ms = 20000): Promise<void> {
    const end = Date.now() + ms;
    while (Date.now() < end) {
      const t = this.text();
      if (t.includes('Picture') && t.includes('Settings')) { await this.wait(600); return; }
      if (/address you|call you/i.test(t)) { this.send('Sir\r'); await this.wait(500); continue; }
      if (t.includes('Just chat - no project folder')) { this.send('\r'); await this.wait(500); continue; }
      if (t.includes('What can I do for you') || t.includes('Just chatting')) { await this.wait(600); return; }
      await this.wait(300);
    }
    throw new Error(`boot never reached the conversation\n${this.text()}`);
  }
  // The lines that have SCROLLED INTO HISTORY above the live screen (3 Oct):
  // since finished conversation text feeds the terminal's own scrollback, the
  // honest check of "was it printed" must include these, not just the viewport.
  history(): string[] {
    const b = this.term.buffer.active; const out: string[] = [];
    const top = b.length - this.rows;
    for (let i = 0; i < top; i++) out.push(b.getLine(i)?.translateToString(true) ?? '');
    return out;
  }
  historyText(): string { return this.history().join('\n'); }
  cursor() { const b = this.term.buffer.active; return { x: b.cursorX, y: b.cursorY }; }
  send(s: string) { this.proc.write(s); }
  async wait(ms: number) { await new Promise((r) => setTimeout(r, ms)); }
  async until(test: (t: string) => boolean, ms = 30000, label = 'condition') {
    const end = Date.now() + ms;
    while (Date.now() < end) { if (test(this.text())) return; await this.wait(150); }
    throw new Error(`timed out waiting for ${label}\n` + this.text());
  }
  // Whether the app has switched mouse reporting ON right now: the last of its on/off messages. A real terminal
  // sends NO mouse clicks unless this is on (this rig would send them regardless - which once hid a screen where
  // the mouse was dead, 30 Sept), so every click made here is refused when it is off.
  mouseOn(): boolean {
    return this.raw.lastIndexOf('\x1b[?1000h') > this.raw.lastIndexOf('\x1b[?1000l');
  }
  // SGR mouse: 1-based column and row
  mouse(kind: 'press' | 'drag' | 'release' | 'up' | 'down', col: number, row: number) {
    if (!this.mouseOn()) throw new Error(`the mouse is OFF on this screen - a real terminal would send nothing\n${this.text()}`);
    const code = { press: '0;M', drag: '32;M', release: '0;m', up: '64;M', down: '65;M' }[kind];
    const [b, f] = code.split(';');
    this.send(`\x1b[<${b};${col};${row}${f}`);
  }
  kill() { try { this.proc.kill(); } catch {} }
}
