import { spawn } from 'node:child_process';
import type { ResultPromise } from 'execa';

// Ending a command properly. A polite stop signal (SIGTERM) can be ignored, and a shell's stop does
// not reach the programs it started (a test server's own process kept running after Stop - checked
// 30 Sept: a command that ignored SIGTERM ran on for its full 30 seconds). So: ask politely, then
// after a moment force it; and for a command left running in the background, stop its whole group.
const FORCE_AFTER_MS = 2_000;

export function terminate(child: ResultPromise, options: { group?: boolean } = {}): void {
  const send = (signal: NodeJS.Signals) => {
    try {
      if (process.platform === 'win32') {
        // Windows: taskkill ends the program and everything it started.
        if (child.pid) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' }).on('error', () => {});
      } else if (options.group && child.pid) {
        process.kill(-child.pid, signal);
      } else {
        child.kill(signal);
      }
    } catch {
      // Already gone.
    }
  };
  send('SIGTERM');
  if (process.platform === 'win32') return;
  const timer = setTimeout(() => send('SIGKILL'), FORCE_AFTER_MS);
  timer.unref();
  void child.then(() => clearTimeout(timer), () => clearTimeout(timer));
}
