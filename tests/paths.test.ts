import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { homeLocations, listSubfolders, displayPath, projectNameProblem } from '../src/platform/paths.js';

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

describe('project name validation', () => {
  it('accepts normal names and trims padding', () => {
    expect(projectNameProblem('My App')).toBeNull();
    expect(projectNameProblem('  Padded Name  ')).toBeNull();
    expect(projectNameProblem('Website Redesign 2026')).toBeNull();
  });

  it('rejects empty names in plain English', () => {
    expect(projectNameProblem('   ')).toContain('Give the project a name');
  });

  it('rejects characters filesystems cannot take', () => {
    for (const bad of ['a/b', 'a\\b', 'a:b', 'a*b', 'a?b', 'a"b', 'a<b', 'a>b', 'a|b']) {
      expect(projectNameProblem(bad)).toContain('cannot contain');
    }
  });

  it('rejects bare dot names', () => {
    expect(projectNameProblem('.')).toContain('not a valid name');
    expect(projectNameProblem('..')).toContain('not a valid name');
  });
});