import { dispatchMouse } from './mouse.js';

// The one place mouse reports are taken out of the keyboard stream - before Ink
// (and so before any screen) ever sees them. Claude Code does the same: its
// tokenizer (ink/termio) parses mouse reports as their own events and buffers a
// report that arrives in two pieces, instead of every screen guarding against them.
//
// The fault this fixes (26 Sept, reproduced in a real window): the terminal writes
// a wheel report as ESC [ < 65 ; 36 ; 13 M, but the operating system can hand it over
// in two pieces. Ink flushes a half report after 20 ms as ordinary typing, so the
// rest arrived as text and "[<65;36;13M" appeared in the typing box - on and off for
// weeks, screen by screen, because each screen carried its own guard.
//
// Here: whole reports are removed from the chunk and passed to the mouse handler;
// a report cut short at the end of the chunk is held (up to a second) until its rest
// arrives; and a lone Escape at the end of a chunk is held for 40 ms in case it is
// the start of a report (a real Escape key press still gets through, 40 ms later).
const MOUSE_REPORT = /\x1b\[<\d+;\d+;\d+[Mm]/g;
// The same report with its Escape lost: only trusted at the very start of a chunk.
const ORPHAN_REPORT = /^\[<\d+;\d+;\d+[Mm]/;
// The end of a chunk that could be the front of a report: ESC, ESC [, ESC [ < 65 ; 3 ...
const CUT_SHORT = /\x1b(?:\[(?:<[\d;]*)?)?$/;
const MOUSE_BODY = /^\x1b\[(?:<[\d;]*)?$/;
const HOLD_MS = 1000;
const ESC_HOLD_MS = 40;

export class MouseFilter {
  private carry = '';

  // Returns the chunk without any mouse reports; complete ones go to dispatch.
  // Whatever could be the front of a report is held back (see holding()).
  push(chunk: string, dispatch: (report: string) => void): string {
    let text = this.carry + chunk;
    this.carry = '';
    const orphan = ORPHAN_REPORT.exec(text);
    if (orphan) {
      dispatch(orphan[0]);
      text = text.slice(orphan[0].length);
    }
    text = text.replace(MOUSE_REPORT, (report) => {
      dispatch(report);
      return '';
    });
    const cut = CUT_SHORT.exec(text);
    if (cut) {
      this.carry = cut[0];
      text = text.slice(0, cut.index);
    }
    return text;
  }

  holding(): boolean {
    return this.carry !== '';
  }

  // How long a held piece is worth waiting for its rest: a piece that can only be a
  // mouse report (ESC [ <) waits longer than a bare Escape, which may be the key.
  holdMs(): number {
    return MOUSE_BODY.test(this.carry) ? HOLD_MS : ESC_HOLD_MS;
  }

  // Gives up waiting: the held piece, and whether it can only have been a mouse report.
  release(): { text: string; mouse: boolean } {
    const held = { text: this.carry, mouse: MOUSE_BODY.test(this.carry) };
    this.carry = '';
    return held;
  }
}

// Puts the filter between the terminal and Ink. Ink reads the keyboard with
// stdin.read(); this wraps that one call.
export function installMouseFilter(stdin: NodeJS.ReadStream = process.stdin): void {
  const filter = new MouseFilter();
  const original = stdin.read.bind(stdin);
  let timer: NodeJS.Timeout | null = null;
  let bypass = false;
  stdin.read = ((size?: number) => {
    const raw = original(size);
    if (raw === null || raw === undefined) return raw;
    // A piece handed back after waiting goes straight to Ink, once.
    if (bypass) {
      bypass = false;
      return raw;
    }
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const out = filter.push(typeof raw === 'string' ? raw : Buffer.from(raw).toString('utf8'), dispatchMouse);
    if (filter.holding()) {
      timer = setTimeout(() => {
        timer = null;
        const held = filter.release();
        // A half mouse report is junk; a bare Escape (or ESC [) is a real key: hand it back.
        if (!held.mouse && held.text) {
          bypass = true;
          stdin.unshift(held.text);
        }
      }, filter.holdMs());
    }
    return out;
  }) as typeof stdin.read;
}
