import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { homeLocations, listSubfolders, displayPath } from '../src/platform/paths.js';

describe('folder browser helpers', () => {
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'jeeves-folders-'));
    await mkdir(path.join(dir, 'alpha'));
    await mkdir(path.join(dir, 'Zebra'));
    await mkdir(path.join(dir, '.hidden'));
    await mkdir(path.join(dir, 'nested'));
    await mkdir(path.join(dir, 'nested', 'inner'));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('lists subfolders sorted, ignoring files and dot-folders', () => {
    const { folders, error } = listSubfolders(dir);
    expect(error).toBe('');
    const names = folders.map((folder) => folder.name);
    expect(names).toEqual(['alpha', 'nested', 'Zebra']);
    for (const folder of folders) {
      expect(folder.path).toBe(path.join(dir, folder.name));
    }
  });

  it('drills into nested folders', () => {
    const { folders } = listSubfolders(path.join(dir, 'nested'));
    expect(folders.map((folder) => folder.name)).toEqual(['inner']);
  });

  it('reports unopenable folders instead of throwing', () => {
    const { folders, error } = listSubfolders(path.join(dir, 'missing'));
    expect(folders).toEqual([]);
    expect(error).toContain('could not be opened');
  });

  it('offers the standard user locations that exist', () => {
    const locations = homeLocations();
    expect(locations.length).toBeGreaterThanOrEqual(1);
    for (const location of locations) {
      expect(location.name.length).toBeGreaterThan(0);
    }
  });

  it('shortens home paths to ~ form', () => {
    const home = displayPath('~');
    expect(home).toBe('~');
    const outside = displayPath(path.join(tmpdir(), 'elsewhere'));
    expect(outside).toBe(path.join(tmpdir(), 'elsewhere'));
  });
});