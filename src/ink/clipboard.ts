// THE CLIPBOARD (kept from the old selection module - 3 Oct): the terminal's
// clipboard escape (OSC 52) always, and - on this computer, not over SSH - its
// own clipboard program too, because OSC 52 depends on terminal settings
// (several Linux terminals ignore it): pbcopy on a Mac, clip on Windows, and on
// Linux the first of wl-copy (Wayland), xclip or xsel (X11) that exists,
// remembered after the first copy. Selecting and copying in the plain
// conversation is now the TERMINAL's own (drag + Cmd+C); this module serves the
// Copy-last-answer command and anything else that copies programmatically.
import { spawn } from 'node:child_process';

let linuxCopy: [string, string[]] | null | undefined;

function runCopy(program: string, args: string[], text: string): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(program, args, { stdio: ['pipe', 'ignore', 'ignore'] });
      const timer = setTimeout(() => child.kill(), 2000);
      child.on('error', () => {
        clearTimeout(timer);
        resolve(false);
      });
      child.on('close', (code) => {
        clearTimeout(timer);
        resolve(code === 0);
      });
      child.stdin.on('error', () => {});
      child.stdin.end(text);
    } catch {
      resolve(false);
    }
  });
}

export async function copyNative(text: string): Promise<boolean> {
  if (process.platform === 'darwin') return runCopy('pbcopy', [], text);
  if (process.platform === 'win32') return runCopy('clip', [], text);
  if (linuxCopy === null) return false;
  if (linuxCopy) return runCopy(linuxCopy[0], linuxCopy[1], text);
  const candidates: [string, string[]][] = [['wl-copy', []], ['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]];
  for (const candidate of candidates) {
    if (await runCopy(candidate[0], candidate[1], text)) {
      linuxCopy = candidate;
      return true;
    }
  }
  linuxCopy = null;
  return false;
}

export async function copyToClipboard(text: string): Promise<boolean> {
  let sent = false;
  try {
    process.stdout.write(`\x1b]52;c;${Buffer.from(text, 'utf8').toString('base64')}\x07`);
    sent = true;
  } catch {
    // A closed stream: the clipboard program below may still work.
  }
  if (process.env.SSH_CONNECTION) return sent;
  return (await copyNative(text)) || sent;
}
