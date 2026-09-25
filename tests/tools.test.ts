import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import os from 'node:os';
import path from 'node:path';
import { expandPath } from '../src/platform/paths.js';
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

// THE one path expansion every tool goes through - Claude Code's expandPath
// (src/utils/path.ts), the same contract OpenCode's file tools implement with
// their "must be absolute, not relative" schemas. 25 Sept: path.resolve alone
// treated ~ as a folder NAME, so ~/Documents/Projects "did not exist".
describe('expandPath (the one path helper, both sources\' contract)', () => {
  it('expands the home shorthand, normalises absolute, and resolves relative against the base', () => {
    expect(expandPath('~')).toBe(homedir());
    expect(expandPath('~/Documents/Projects')).toBe(path.join(homedir(), 'Documents/Projects'));
    expect(expandPath('/tmp/x/../y', '/base')).toBe(path.normalize('/tmp/y'));
    expect(expandPath('notes/a.txt', '/base')).toBe('/base/notes/a.txt');
    expect(expandPath('./x', '/base')).toBe('/base/x');
    // Claude Code's contract: whitespace trimmed, empty means the base folder.
    expect(expandPath('  ~/x  ')).toBe(path.join(homedir(), 'x'));
    expect(expandPath('', '/base')).toBe('/base');
    expect(expandPath('   ', '/base')).toBe('/base');
    // A bare ~name (another user's folder) is NOT our home folder.
    expect(expandPath('~other/x', '/base')).toBe('/base/~other/x');
    // Null bytes are refused before anything touches the filesystem.
    expect(() => expandPath('a\0b')).toThrow();
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

  // 25 Sept: "~/Documents/Projects" was answered with "That folder does not
  // exist." - the tilde must mean the home folder, as the shell reads it.
  it('listDir, readFile and writeFile understand the home-folder shorthand (~/...)', async () => {
    const homeDir = path.join(os.homedir(), `jeeves-tilde-${path.basename(dir)}`);
    await mkdir(homeDir, { recursive: true });
    try {
      await writeFile(path.join(homeDir, 'note.txt'), 'found me');
      const tilde = `~/${path.basename(homeDir)}`;
      expect(await runListDir({ path: tilde })).toContain('note.txt');
      expect(await runReadFile({ path: `${tilde}/note.txt` })).toBe('found me');
      await runWriteFile({ path: `${tilde}/made.txt`, content: 'written' });
      expect(await runReadFile({ path: `${tilde}/made.txt` })).toBe('written');
    } finally {
      await rm(homeDir, { recursive: true, force: true });
    }
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

  // Starting a real shell can take several seconds on a cold Windows machine: GitHub's
  // Windows check timed out at vitest's 5-second default now and then (18-19 Sept).
  // Jeeves itself puts no such limit on a command.
  const SHELL_TIMEOUT = 30_000;

  it('runBash runs a command and reports output', async () => {
    const out = await runRunBash({ command: 'echo jeeves-ok' });
    expect(out).toContain('jeeves-ok');
    expect(out).toContain('exit code: 0');
  }, SHELL_TIMEOUT);

  it('runBash reports a failing exit code without throwing', async () => {
    const out = await runRunBash({ command: 'exit 3' });
    expect(out).toContain('exit code: 3');
  }, SHELL_TIMEOUT);
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