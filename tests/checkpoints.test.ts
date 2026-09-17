import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, mkdirSync, symlinkSync, statSync, chmodSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CheckpointStore, MAX_FILE_BYTES } from '../src/checkpoints/store.js';
import { isOutsideProject, commandMayReachOutside } from '../src/checkpoints/index.js';

let root: string;
let folder: string;
let storeRoot: string;
const write = (rel: string, text: string) => {
  mkdirSync(path.dirname(path.join(folder, rel)), { recursive: true });
  writeFileSync(path.join(folder, rel), text);
};
const read = (rel: string) => readFileSync(path.join(folder, rel), 'utf8');
const has = (rel: string) => existsSync(path.join(folder, rel));

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'jeeves-cp-'));
  folder = path.join(root, 'My Project');
  storeRoot = path.join(root, 'store');
  mkdirSync(folder);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('backups and undo', () => {
  it('puts back changed and deleted files and removes new ones, even when a command did it', async () => {
    write('letter.txt', 'Dear Sir');
    write('notes/todo.md', '- milk');
    const store = new CheckpointStore(storeRoot, folder);
    await store.create('tidy my folder');
    // What a shell command might do: edit, delete, rename, create a folder of files.
    execSync('printf "changed" > letter.txt && rm notes/todo.md && mkdir -p new/deep && printf x > new/deep/a.txt && mv letter.txt letter-old.txt', { cwd: folder });
    const result = await store.restore((await store.latestUndoable())!);
    expect(read('letter.txt')).toBe('Dear Sir');
    expect(read('notes/todo.md')).toBe('- milk');
    expect(has('letter-old.txt')).toBe(false);
    expect(has('new')).toBe(false);
    expect(result.restored).toEqual(['letter.txt', path.join('notes', 'todo.md')]);
    expect(result.removed).toEqual(['letter-old.txt', path.join('new', 'deep', 'a.txt')].sort());
    expect(result.failed).toEqual([]);
  });

  it('each /undo goes one step further back, and an undo never undoes itself', async () => {
    write('a.txt', 'v1');
    const store = new CheckpointStore(storeRoot, folder);
    await store.create('first', 1000);
    write('a.txt', 'v2');
    await store.create('second', 2000);
    write('a.txt', 'v3');
    await store.restore((await store.latestUndoable())!, 3000);
    expect(read('a.txt')).toBe('v2');
    await store.restore((await store.latestUndoable())!, 4000);
    expect(read('a.txt')).toBe('v1');
    expect(await store.latestUndoable()).toBeUndefined();
    // The safety copies taken before each undo are kept, so nothing is ever lost.
    expect((await store.list()).filter((c) => c.kind === 'before-undo').length).toBe(2);
  });

  it('stores unchanged content once, and keeps file permissions', async () => {
    write('run.sh', 'echo hi');
    chmodSync(path.join(folder, 'run.sh'), 0o755);
    const store = new CheckpointStore(storeRoot, folder);
    const first = await store.create('one', 1);
    const second = await store.create('two', 2);
    expect(second.files['run.sh'].hash).toBe(first.files['run.sh'].hash);
    rmSync(path.join(folder, 'run.sh'));
    await store.restore(second, 3);
    expect(statSync(path.join(folder, 'run.sh')).mode & 0o777).toBe(0o755);
  });

  it("leaves the person's own .git history and rebuildable add-on folders alone", async () => {
    write('.git/HEAD', 'ref: main');
    write('node_modules/x/index.js', 'x');
    write('app.js', 'a');
    const checkpoint = await new CheckpointStore(storeRoot, folder).create('x');
    expect(Object.keys(checkpoint.files)).toEqual(['app.js']);
  });

  it('says plainly what could not be backed up, and then never deletes blind', async () => {
    write('real.txt', 'keep');
    symlinkSync(path.join(folder, 'real.txt'), path.join(folder, 'shortcut.txt'));
    const store = new CheckpointStore(storeRoot, folder);
    const checkpoint = await store.create('x', 1);
    expect(checkpoint.skipped).toEqual(['"shortcut.txt" is a shortcut (link), which is not backed up']);
    write('created-later.txt', 'mine');
    const result = await store.restore(checkpoint, 2);
    expect(has('created-later.txt')).toBe(true);
    expect(result.removed).toEqual([]);
  });

  it('skips a file too large to back up', async () => {
    writeFileSync(path.join(folder, 'huge.bin'), Buffer.alloc(MAX_FILE_BYTES + 1));
    const checkpoint = await new CheckpointStore(storeRoot, folder).create('x');
    expect(checkpoint.skipped).toEqual(['"huge.bin" is too large to back up']);
  });

  it('keeps each project folder separate', async () => {
    const other = path.join(root, 'Other');
    mkdirSync(other);
    write('a.txt', 'mine');
    await new CheckpointStore(storeRoot, folder).create('x');
    expect(await new CheckpointStore(storeRoot, other).latestUndoable()).toBeUndefined();
  });
});

describe('warnings for changes /undo cannot reverse', () => {
  it('knows what is outside the project folder', () => {
    expect(isOutsideProject('notes/a.txt', '/Users/sam/Project')).toBe(false);
    expect(isOutsideProject('../elsewhere.txt', '/Users/sam/Project')).toBe(true);
    expect(isOutsideProject('/Users/sam/Desktop/x.txt', '/Users/sam/Project')).toBe(true);
    expect(isOutsideProject('/Users/sam/Project/x.txt', '/Users/sam/Project')).toBe(false);
  });

  it('flags commands that may reach outside the folder', () => {
    const here = '/Users/sam/Project';
    for (const command of ['rm -rf ~/Desktop/old', 'cp a.txt ../backup/', 'sudo rm x', 'npm install -g thing', 'brew install wget', 'mv x /Users/sam/Desktop/', 'cat notes.txt > $HOME/out.txt']) {
      expect(commandMayReachOutside(command, here), command).toBe(true);
    }
    for (const command of ['node --test', 'rm old.txt', 'mkdir -p build/out', 'python3 tidy.py > /dev/null', `cp a.txt ${here}/b.txt`, 'npm install']) {
      expect(commandMayReachOutside(command, here), command).toBe(false);
    }
  });
});
