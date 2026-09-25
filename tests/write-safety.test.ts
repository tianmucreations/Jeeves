import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { TOOLS } from '../src/tools/index.js';
import { runReadFile } from '../src/tools/readFile.js';
import { writeRefusal, writePreview, resetSeenFiles } from '../src/tools/write-safety.js';
import { PlainError } from '../src/tools/plain.js';
import { buildDisplayLines } from '../src/components/transcript-layout.js';
import { session } from '../src/state/session.js';
import { answerApproval, hasPendingApproval } from '../src/agent/permissions.js';
import { untrustProject } from '../src/agent/trust.js';

// Claude Code's read-before-write discipline, built at the root (FileWriteTool
// validateInput + the mtime re-check): a write to an existing file the
// conversation has not read is refused before any question, a file changed
// since it was read is refused too, and the permission question shows the
// actual changed lines. Every refusal test here fails on the old code, which
// happily overwrote files nobody had looked at.

const options = { toolCallId: 't', messages: [] } as never;

// The gate's asks resolve in microtasks after execute() starts; wait until the
// question is actually on screen, then answer it.
async function waitUntilAsked(): Promise<void> {
  for (let i = 0; i < 200 && !hasPendingApproval(); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  expect(hasPendingApproval()).toBe(true);
}

async function lastToolLine() {
  const entry = [...session.transcript].reverse().find((candidate) => candidate.kind === 'tool');
  return entry && entry.kind === 'tool' ? entry.data : null;
}

describe('read-before-write (write-safety)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'jeeves-writesafety-'));
    resetSeenFiles();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    resetSeenFiles();
    untrustProject();
  });

  it('a brand-new file needs no read and writes as before (it asks, being outside the folder)', async () => {
    const call = TOOLS.writeFile.execute!({ path: path.join(dir, 'new.txt'), content: 'hello' }, options);
    await waitUntilAsked();
    answerApproval(true);
    await call;
    expect(await runReadFile({ path: path.join(dir, 'new.txt') })).toBe('hello');
  });

  it('an existing file nobody has read is refused before the question', async () => {
    await writeFile(path.join(dir, 'unread.txt'), 'original words');
    await expect(
      TOOLS.writeFile.execute!({ path: path.join(dir, 'unread.txt'), content: 'clobbered' }, options)
    ).rejects.toThrow("hasn't been read yet");
    // The record line says so in plain words, and nothing was overwritten.
    const line = await lastToolLine();
    expect(line?.state).toBe('failed');
    expect(line?.label).toContain("hasn't been read yet");
    expect(await runReadFile({ path: path.join(dir, 'unread.txt') })).toBe('original words');
  });

  it('after a read the write goes ahead, and a further write needs no second read', async () => {
    await runReadFile({ path: path.join(dir, 'unread.txt') });
    const first = TOOLS.writeFile.execute!({ path: path.join(dir, 'unread.txt'), content: 'second words' }, options);
    await waitUntilAsked();
    answerApproval(true);
    await first;
    expect(await runReadFile({ path: path.join(dir, 'unread.txt') })).toBe('second words');
    const second = TOOLS.writeFile.execute!({ path: path.join(dir, 'unread.txt'), content: 'third words' }, options);
    await waitUntilAsked();
    answerApproval(true);
    await second;
    expect(await runReadFile({ path: path.join(dir, 'unread.txt') })).toBe('third words');
  });

  it('a file changed since it was read is refused, and a fresh read releases it', async () => {
    // Changed behind the conversation's back, as if the person edited it by hand.
    await writeFile(path.join(dir, 'unread.txt'), 'edited by the person');
    await expect(
      TOOLS.writeFile.execute!({ path: path.join(dir, 'unread.txt'), content: 'stale clobber' }, options)
    ).rejects.toThrow('changed since it was last read');
    await runReadFile({ path: path.join(dir, 'unread.txt') });
    const call = TOOLS.writeFile.execute!({ path: path.join(dir, 'unread.txt'), content: 'now current' }, options);
    await waitUntilAsked();
    answerApproval(true);
    await call;
    expect(await runReadFile({ path: path.join(dir, 'unread.txt') })).toBe('now current');
  });

  it('a fresh conversation starts the memory over: the same file is refused again', async () => {
    resetSeenFiles();
    expect(await writeRefusal(path.join(dir, 'unread.txt'))).toContain("hasn't been read yet");
  });

  it('the refusal never reaches the permission stage', async () => {
    await writeFile(path.join(dir, 'never-read.txt'), 'safe');
    await expect(
      TOOLS.writeFile.execute!({ path: path.join(dir, 'never-read.txt'), content: 'x' }, options)
    ).rejects.toBeInstanceOf(PlainError);
    expect(hasPendingApproval()).toBe(false);
  });
});

describe('the change preview on the question (write-safety)', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'jeeves-preview-'));
    resetSeenFiles();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    resetSeenFiles();
  });

  it('a new file previews its first lines and its size', async () => {
    const preview = await writePreview(path.join(dir, 'fresh.txt'), 'line one\nline two');
    expect(preview).toContain('+ line one');
    expect(preview).toContain('a new file, 2 lines');
  });

  it('a change previews the old line out and the new line in', async () => {
    const target = path.join(dir, 'edit.txt');
    await writeFile(target, 'keep\nchange me\nkeep too');
    const preview = await writePreview(target, 'keep\nchanged line\nkeep too');
    expect(preview).toContain('- change me');
    expect(preview).toContain('+ changed line');
    expect(preview).not.toContain('keep');
  });

  it('a big rewrite is capped with a note of how much is hidden', async () => {
    const target = path.join(dir, 'big.txt');
    await writeFile(target, ['old 1', 'old 2', 'old 3', 'old 4', 'old 5'].join('\n'));
    const preview = await writePreview(target, ['new 1', 'new 2', 'new 3', 'new 4', 'new 5', 'new 6'].join('\n'));
    expect(preview).toContain('- old 1');
    expect(preview).toContain('more changed lines');
  });

  it('an identical write previews nothing', async () => {
    const target = path.join(dir, 'same.txt');
    await writeFile(target, 'same');
    expect(await writePreview(target, 'same')).toBeNull();
  });

  it('the preview lines sit above the waiting question and vanish once answered', async () => {
    const target = path.join(dir, 'question.txt');
    await writeFile(target, 'before text');
    await runReadFile({ path: target });
    const before = session.transcript.length;
    const call = TOOLS.writeFile.execute!({ path: target, content: 'after text' }, options);
    await waitUntilAsked();
    const waitingLines = buildDisplayLines(session.transcript.slice(before), 80).map((line) => line.text);
    answerApproval(false);
    await call.catch(() => {});
    expect(waitingLines.some((line) => line.includes('- before text'))).toBe(true);
    expect(waitingLines.some((line) => line.includes('+ after text'))).toBe(true);
    // The question itself (the long temp path is clipped at the window's width,
    // so match on the question's start, not its tail).
    expect(waitingLines.some((line) => line.startsWith('? Write'))).toBe(true);
    // Answered: the record line stays, the preview does not.
    const after = buildDisplayLines(session.transcript.slice(before), 80).map((line) => line.text);
    expect(after.some((line) => line.startsWith('? Write'))).toBe(false);
    expect(after.some((line) => line.includes('+ after text'))).toBe(false);
  });
});
