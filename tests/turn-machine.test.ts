import { describe, it, expect, vi, afterEach } from 'vitest';
import { turns } from '../src/core/turn-machine.js';
import { session } from '../src/state/session.js';
import { requestApproval, answerApproval, hasPendingApproval } from '../src/agent/permissions.js';
import { askQuestion, answerQuestion, cancelQuestion } from '../src/agent/question.js';
import { ensureCheckpoint, startTurnCheckpoints } from '../src/checkpoints/index.js';
import { CheckpointStore } from '../src/checkpoints/store.js';
import { summariseHistory } from '../src/agent/context.js';

// Every test here catches a bug the pre-refactor background layer had
// (owner's order, 3 Oct: deterministic state machine, no loose globals).

afterEach(() => {
  // Leave the machine and the queues exactly as found, whatever a test did.
  if (turns.active) turns.release(turns.currentGeneration);
  while (hasPendingApproval()) answerApproval(false);
  cancelQuestion();
});

describe('the turn machine: one job at a time, reserved atomically', () => {
  it('a second job cannot start while one is running (the old race window let it)', () => {
    const first = turns.reserve();
    expect(first).not.toBeNull();
    const second = turns.reserve();
    expect(second).toBeNull();
    turns.release(first!);
    const third = turns.reserve();
    expect(third).not.toBeNull();
    turns.release(third!);
  });

  it('a finished job cannot touch the machine (stale generation refused)', () => {
    const generation = turns.reserve();
    turns.release(generation!);
    expect(turns.to('streaming', generation!)).toBe(false);
    expect(turns.release(generation!)).toBeUndefined();
    expect(session.status).toBe('idle');
  });
});

describe('THE STUCK-WINDOW BUG (his "Text Box Missing" screenshot): the window can never be left fake-busy', () => {
  it('declining a spending question before a job starts returns the window to idle', async () => {
    // The old sequence: reserve, the money question appears, the person says no,
    // and the job gave up - leaving status hard-coded to "working" with nothing
    // running: no typing box, messages queued forever, only quitting recovered.
    const generation = turns.reserve();
    expect(generation).not.toBeNull();
    expect(session.status).toBe('working');
    const approved = requestApproval();
    expect(session.status).toBe('awaiting-approval');
    expect(session.approvalPending).toBe(true);
    answerApproval(false);
    expect(await approved).toBe(false);
    expect(session.status).toBe('working'); // back to the job while it winds up
    turns.release(generation!);
    expect(session.status).toBe('idle'); // THE FIX: the old code stayed "working" forever
    expect(session.approvalPending).toBe(false);
  });

  it('a question answered after its job already ended goes to idle, never to a fake "working"', () => {
    session.setActiveApproval();
    expect(session.status).toBe('awaiting-approval');
    // No job holds the window (generation 0): the answer must land on idle.
    session.clearActiveApproval();
    expect(session.status).toBe('idle');
  });

  it('nothing may stamp "working" over an empty window', () => {
    expect(session.status).toBe('idle');
    session.setStatus('working');
    expect(session.status).toBe('idle');
  });

  it('a running job may not stamp "idle" over itself (the status fight that let a second message start inside the first)', () => {
    const generation = turns.reserve();
    session.setStatus('idle');
    expect(session.status).toBe('working');
    turns.release(generation!);
    expect(session.status).toBe('idle');
  });

  it('a job that fails with a broken connection stays flagged until the person tries again', () => {
    const generation = turns.reserve();
    session.setStatus('disconnected');
    turns.release(generation!);
    expect(session.status).toBe('disconnected');
    // The next message may try again, and the flag clears.
    const next = turns.reserve();
    expect(next).not.toBeNull();
    expect(session.status).toBe('working');
    turns.release(next!);
  });
});

describe('questions queue instead of overwriting each other (the wedge fix)', () => {
  it('a second question waits its turn; both answers arrive; nothing hangs', async () => {
    const first = askQuestion({ question: 'Which one?', options: [{ label: 'Tea' }, { label: 'Coffee' }] });
    const second = askQuestion({ question: 'And to eat?', options: [{ label: 'Cake' }, { label: 'Biscuit' }] });
    expect(session.question?.question).toBe('Which one?');
    answerQuestion('Tea');
    expect(await first).toBe('Tea');
    expect(session.question?.question).toBe('And to eat?');
    answerQuestion('Biscuit');
    expect(await second).toBe('Biscuit');
    expect(session.question).toBeNull();
  });

  it('Stop releases the one on screen and every queued question at once', async () => {
    const first = askQuestion({ question: 'One?', options: [{ label: 'A' }, { label: 'B' }] });
    const second = askQuestion({ question: 'Two?', options: [{ label: 'C' }, { label: 'D' }] });
    cancelQuestion();
    expect(await first).toBe('');
    expect(await second).toBe('');
    expect(session.question).toBeNull();
  });
});

describe('the folder backup happens once even when two changes race (the double-backup fix)', () => {
  it('two parallel changes share one backup attempt', async () => {
    const dir = `${process.env.JEEVES_CHECKPOINTS_DIR ?? '/private/tmp'}/turn-machine-test`;
    process.env.JEEVES_CHECKPOINTS_DIR = dir;
    const created = vi.spyOn(CheckpointStore.prototype, 'create').mockResolvedValue({ id: 'x', label: 'test', createdAt: 0, kind: 'turn' as const, files: [], skipped: [] } as never);
    startTurnCheckpoints('a racing change');
    const [a, b] = await Promise.all([ensureCheckpoint(), ensureCheckpoint()]);
    expect(a.ok).toBe(true);
    expect(b.ok).toBe(true);
    expect(created).toHaveBeenCalledTimes(1);
    created.mockRestore();
  });
});

describe('the conversation summary is interruptible and writes no status', () => {
  it('a stopped job ends the summary too, and the summary never touches the status flag', async () => {
    const stop = new AbortController();
    stop.abort();
    session.setStatus('disconnected'); // any non-idle word must survive the summary
    await summariseHistory(stop.signal);
    expect(session.tidying).toBe(false);
    expect(session.status).toBe('disconnected');
    session.setStatus('idle');
  });
});
