import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { readFileSchema, runReadFile } from '../src/tools/readFile.js';
import { writeFileSchema, runWriteFile } from '../src/tools/writeFile.js';
import { listDirSchema, runListDir } from '../src/tools/listDir.js';
import { runBashSchema, runRunBash } from '../src/tools/runBash.js';
import { requestApproval, answerApproval, hasPendingApproval } from '../src/agent/permissions.js';
import { session } from '../src/state/session.js';

describe('tool schemas validate strictly', () => {
  it('readFile accepts { path }', () => {
    expect(readFileSchema.parse({ path: 'a.txt' })).toEqual({ path: 'a.txt' });
  });
  it('readFile rejects a missing path', () => {
    expect(() => readFileSchema.parse({})).toThrow();
  });
  it('writeFile requires both path and content', () => {
    expect(() => writeFileSchema.parse({ path: 'x.txt' })).toThrow();
    expect(writeFileSchema.parse({ path: 'x.txt', content: 'hello' })).toEqual({ path: 'x.txt', content: 'hello' });
  });
  it('listDir rejects a non-string path', () => {
    expect(() => listDirSchema.parse({ path: 5 })).toThrow();
    expect(listDirSchema.parse({ path: '.', recursive: true })).toEqual({ path: '.', recursive: true });
  });
  it('runBash rejects a missing command', () => {
    expect(() => runBashSchema.parse({})).toThrow();
  });
});

describe('tool executors', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'jeeves-test-'));
    await writeFile(path.join(dir, 'hello.txt'), 'hi');
    await writeFile(path.join(dir, '.gitignore'), 'secret.txt\n');
    await writeFile(path.join(dir, 'secret.txt'), 'hidden');
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('readFile reads a file', async () => {
    expect(await runReadFile({ path: path.join(dir, 'hello.txt') })).toBe('hi');
  });

  it('readFile fails clearly on a missing file', async () => {
    await expect(runReadFile({ path: path.join(dir, 'missing.txt') })).rejects.toThrow();
  });

  it('listDir lists a folder and respects .gitignore', async () => {
    const out = await runListDir({ path: dir });
    expect(out).toContain('hello.txt');
    expect(out).not.toContain('secret.txt');
  });

  it('listDir lists recursively when asked', async () => {
    const out = await runListDir({ path: dir, recursive: true });
    expect(out).toContain('hello.txt');
    expect(out).not.toContain('secret.txt');
  });

  it('listDir fails clearly on a missing folder', async () => {
    await expect(runListDir({ path: path.join(dir, 'nope') })).rejects.toThrow('does not exist');
  });

  it('writeFile writes content and creates folders', async () => {
    const target = path.join(dir, 'new', 'made.txt');
    await runWriteFile({ path: target, content: 'x' });
    expect(await runReadFile({ path: target })).toBe('x');
  });

  it('runBash runs a command and reports output', async () => {
    const out = await runRunBash({ command: 'echo jeeves-ok' });
    expect(out).toContain('jeeves-ok');
    expect(out).toContain('exit code: 0');
  });

  it('runBash reports a failing exit code without throwing', async () => {
    const out = await runRunBash({ command: 'exit 3' });
    expect(out).toContain('exit code: 3');
  });
});

describe('permission gate', () => {
  it('requestApproval blocks until answered, then clears the pending state', async () => {
    expect(hasPendingApproval()).toBe(false);
    const pending = requestApproval();
    expect(hasPendingApproval()).toBe(true);
    expect(session.status).toBe('awaiting-approval');
    answerApproval(true);
    expect(await pending).toBe(true);
    expect(hasPendingApproval()).toBe(false);
  });

  it('a decline resolves to false and returns control', async () => {
    const pending = requestApproval();
    answerApproval(false);
    expect(await pending).toBe(false);
  });

  it('queued approvals are answered one at a time', async () => {
    const first = requestApproval();
    const second = requestApproval();
    answerApproval(true);
    expect(await first).toBe(true);
    expect(hasPendingApproval()).toBe(true);
    answerApproval(false);
    expect(await second).toBe(false);
  });
});