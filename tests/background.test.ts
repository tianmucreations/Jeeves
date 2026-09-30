import { describe, it, expect, afterEach } from 'vitest';
import { startBackground, stopBackground, runBackgroundTask, runningTasks, resetBackground } from '../src/tools/background.js';
import { runRunBash } from '../src/tools/runBash.js';
import { footerSegments } from '../src/components/Footer.js';
import { session } from '../src/state/session.js';

afterEach(() => resetBackground());
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('background tasks (Claude Code "1 shell", in plain words)', () => {
  it('starts without waiting, keeps its output, shows in the session, and stops on request', async () => {
    const reply = await runRunBash({ command: 'echo hello; sleep 30', background: true });
    expect(reply).toContain('task #1');
    await wait(400);
    expect(runningTasks()).toHaveLength(1);
    expect(session.backgroundTasks).toHaveLength(1);
    expect(runBackgroundTask({ action: 'read', id: 1 })).toContain('hello');
    expect(runBackgroundTask({ action: 'stop', id: 1 })).toContain('Stopped');
    await wait(300);
    expect(session.backgroundTasks).toHaveLength(0);
  });
  it('a task that ends by itself leaves the count', async () => {
    startBackground('echo done');
    await wait(500);
    expect(runningTasks()).toHaveLength(0);
    expect(runBackgroundTask({ action: 'list' })).toContain('finished');
  });
  it('the bottom bar says so in plain words', () => {
    const base = { providerId: 'zai', allowance: null, tidying: false, busyNote: null, todaySpend: 0, creditRemaining: null, creditIsAccount: false, planResetAt: null, connected: true } as never;
    expect(footerSegments({ ...(base as object), background: 1 } as never)[0].text).toBe('1 task running - ask me about it');
    expect(footerSegments({ ...(base as object), background: 2 } as never)[0].text).toBe('2 tasks running - ask me about them');
  });
  it('stopping something that is not running says so', () => {
    expect(stopBackground(99)).toBe(false);
  });
});
