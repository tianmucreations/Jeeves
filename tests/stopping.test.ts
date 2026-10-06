import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { startBackground, stopBackground, resetBackground } from '../src/tools/background.js';
import { runRunBash, killAllRunningCommands } from '../src/tools/runBash.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
// Is a program with this in its command line running? The first letter is bracketed so the search does
// not find its own command line (which happens on Linux).
const alive = (marker: string) => {
  try {
    const pattern = `[${marker[0]}]${marker.slice(1)}`;
    return execSync(`pgrep -f "${pattern}" || true`).toString().trim().length > 0;
  } catch {
    return false;
  }
};
afterEach(() => resetBackground());

// Stopping a whole group of programs is Mac and Linux behaviour (Windows uses taskkill); pgrep is theirs too.
describe.skipIf(process.platform === 'win32')('stopping commands properly (his own review, 30 Sept)', () => {
  it('a command that ignores the polite stop is forced to end, and so is what it started', async () => {
    const marker = `jvtest${Date.now()}`;
    startBackground(`sh -c "trap '' TERM; sleep 60; echo ${marker}" & wait`);
    await wait(600);
    expect(alive('sleep 60')).toBe(true);
    stopBackground(1);
    await wait(3500);
    expect(alive('sleep 60')).toBe(false);
  }, 15_000);
  it('leaving Jeeves ends a command that ignores the polite stop (foreground too)', async () => {
    const running = runRunBash({ command: "trap '' TERM; sleep 61", timeout: 30_000 });
    await wait(500);
    const started = Date.now();
    killAllRunningCommands();
    await running.catch(() => {});
    expect(Date.now() - started).toBeLessThan(8_000);
  }, 20_000);
});
