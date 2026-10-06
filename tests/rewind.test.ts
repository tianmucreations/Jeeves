import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startTurnCheckpoints, ensureCheckpoint, rewindPoints, rewindTo } from '../src/checkpoints/index.js';

let root: string;
let folder: string;
const before = process.cwd();
beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'jeeves-rw-'));
  folder = path.join(root, 'proj');
  mkdirSync(folder);
  process.env.JEEVES_CHECKPOINTS_DIR = path.join(root, 'store');
  process.chdir(folder);
});
afterEach(() => {
  process.chdir(before);
  delete process.env.JEEVES_CHECKPOINTS_DIR;
  rmSync(root, { recursive: true, force: true });
});

describe('Go back to an earlier point (the list and the button)', () => {
  it('lists a point for each message that changed something, newest first, and goes back to one', async () => {
    writeFileSync('story.txt', 'chapter 1');
    startTurnCheckpoints('write chapter two');
    await ensureCheckpoint();
    writeFileSync('story.txt', 'chapter 1 and 2');
    await new Promise((r) => setTimeout(r, 15));
    startTurnCheckpoints('write chapter three');
    await ensureCheckpoint();
    writeFileSync('story.txt', 'chapters 1, 2 and 3');
    const points = await rewindPoints();
    expect(points.map((p) => p.label)).toEqual(['write chapter three', 'write chapter two']);
    const outcome = await rewindTo(points[1].id);
    expect(outcome.message).toContain('Gone back');
    expect(outcome.message).toContain('before "write chapter two"');
    expect(outcome.historyNote).toContain('write chapter two');
    expect(readFileSync('story.txt', 'utf8')).toBe('chapter 1');
    // The later point is gone; the safety copy is never offered as a place to go.
    expect(await rewindPoints()).toEqual([]);
  });
  it('a point that is no longer there is said plainly', async () => {
    expect((await rewindTo('does-not-exist')).message).toContain('no longer there');
  });
});
