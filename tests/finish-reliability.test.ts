import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { doomLoopCheck, resetDoomLoop } from '../src/agent/doom-loop.js';
import { noteSummaryFailure, summariserDisabled, resetSummariser, summaryDue, shouldAutoSummarise } from '../src/agent/context.js';
import { TOOLS } from '../src/tools/index.js';

// Batch 3 - finishing reliably, from the sources: OpenCode's doom-loop guard and
// graceful step cap, Claude Code's circuit breaker for the summariser.

describe('the doom-loop guard (OpenCode processor.ts)', () => {
  beforeEach(() => resetDoomLoop());

  it('lets two identical calls pass, then refuses the third with plain words', () => {
    const call = () => doomLoopCheck('readFile', { path: 'notes.txt' });
    expect(call()).toBeNull();
    expect(call()).toBeNull();
    const refusal = call();
    expect(refusal).toContain('three times in a row');
    expect(refusal).toContain('tell the person plainly');
  });

  it('counts only consecutive calls: anything different resets the streak', () => {
    const same = () => doomLoopCheck('readFile', { path: 'notes.txt' });
    expect(same()).toBeNull();
    expect(same()).toBeNull();
    expect(doomLoopCheck('readFile', { path: 'other.txt' })).toBeNull();
    expect(same()).toBeNull();
    expect(same()).toBeNull();
    expect(same()).toContain('three times in a row');
  });

  it('judges input by content, not key order', () => {
    expect(doomLoopCheck('writeFile', { path: 'a.txt', content: 'x' })).toBeNull();
    expect(doomLoopCheck('writeFile', { content: 'x', path: 'a.txt' })).toBeNull();
    expect(doomLoopCheck('writeFile', { path: 'a.txt', content: 'x' })).toContain('three times in a row');
  });

  it('a fresh turn starts clean', () => {
    expect(doomLoopCheck('listDir', { path: '.' })).toBeNull();
    expect(doomLoopCheck('listDir', { path: '.' })).toBeNull();
    resetDoomLoop();
    expect(doomLoopCheck('listDir', { path: '.' })).toBeNull();
  });

  it('inside the real tools: a third identical read is refused', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'jeeves-doom-'));
    try {
      const target = path.join(dir, 'notes.txt');
      await writeFile(target, 'hello');
      const options = { toolCallId: 't', messages: [] } as never;
      await TOOLS.readFile.execute!({ path: target }, options);
      await TOOLS.readFile.execute!({ path: target }, options);
      await expect(TOOLS.readFile.execute!({ path: target }, options)).rejects.toThrow('three times in a row');
    } finally {
      await rm(dir, { recursive: true, force: true });
      resetDoomLoop();
    }
  });
});

describe('the summariser circuit breaker (Claude Code autoCompact.ts)', () => {
  beforeEach(() => resetSummariser());

  it('three consecutive failures stop the summariser; /clear resets it', () => {
    const overThreshold = shouldAutoSummarise(999_999, 200_000);
    expect(overThreshold).toBe(true);
    expect(summaryDue(999_999, 200_000)).toBe(true);
    noteSummaryFailure();
    noteSummaryFailure();
    // Two failures: still trying, but waiting a few messages first.
    expect(summariserDisabled()).toBe(false);
    noteSummaryFailure();
    expect(summariserDisabled()).toBe(true);
    expect(summaryDue(999_999, 200_000)).toBe(false);
    resetSummariser();
    expect(summaryDue(999_999, 200_000)).toBe(true);
  });
});
