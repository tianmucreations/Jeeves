import { describe, it, expect, afterEach } from 'vitest';
import { execSync } from 'node:child_process';
import { startBackground, stopBackground, resetBackground } from '../src/tools/background.js';
import { runRunBash, killAllRunningCommands } from '../src/tools/runBash.js';

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const alive = (marker: string) => {
  try {
    return execSync(`pgrep -f "${marker}" || true`).toString().trim().length > 0;
  } catch {
    return false;
  }
};
afterEach(() => resetBackground());

describe('stopping commands properly (his own review, 30 Sept)', () => {
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
