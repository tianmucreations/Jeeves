import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getFavorites, setFavorites, settingsFolder } from '../src/platform/config.js';
import { mergeToolGroups, buildDisplayLines } from '../src/components/transcript-layout.js';
import { todoHeadline } from '../src/tools/todoList.js';
import type { TranscriptEntry } from '../src/state/session.js';

const tool = (id: number, name: string, state: 'done' | 'failed' | 'declined' | 'running', label = 'x'): TranscriptEntry => ({
  id,
  kind: 'tool',
  data: { tool: name, summary: 'a.txt', state, label },
});

describe('the settings file is read once, not on every draw', () => {
  it('returns copies, so a caller cannot change the saved list by accident', () => {
    setFavorites(['a/b', 'c/d']);
    const first = getFavorites();
    first.push('hacked');
    expect(getFavorites()).toEqual(['a/b', 'c/d']);
  });
  it('still notices a change made by another window (the file itself changed)', () => {
    setFavorites(['one']);
    expect(getFavorites()).toEqual(['one']);
    const file = path.join(settingsFolder(), 'config.json');
    const data = JSON.parse(readFileSync(file, 'utf8'));
    data.favorites = ['two', 'three'];
    writeFileSync(file, JSON.stringify(data, null, '\t'));
    expect(getFavorites()).toEqual(['two', 'three']);
  });
});

describe('seven "Changed 1 file" lines become one', () => {
  it('merges a run of the same finished action, keeps a different one apart', () => {
    const entries = [1, 2, 3, 4, 5, 6, 7].map((n) => tool(n, 'editFile', 'done'));
    const merged = mergeToolGroups(entries);
    expect(merged).toHaveLength(1);
    const lines = buildDisplayLines(merged, 80, false);
    expect(lines.map((l) => l.text).join('\n')).toContain('Changed 7 files');
  });
  it('leaves a lone action and a running one alone', () => {
    expect(mergeToolGroups([tool(1, 'editFile', 'done')])).toHaveLength(1);
    expect(mergeToolGroups([tool(1, 'editFile', 'done'), tool(2, 'editFile', 'running')])).toHaveLength(2);
  });
  it('merges repeated failures into one red line', () => {
    const merged = mergeToolGroups([tool(1, 'editFile', 'failed', 'no match'), tool(2, 'editFile', 'failed', 'no match')]);
    expect(merged).toHaveLength(1);
  });
});

describe('the one-line checklist', () => {
  it('names the step in progress and counts', () => {
    const line = todoHeadline([
      { content: 'Find the invoices', status: 'completed' },
      { content: 'Rename them', status: 'in_progress' },
      { content: 'Make a summary', status: 'pending' },
    ]);
    expect(line).toBe('Step 2 of 3: Rename them (1 done)');
  });
  it('is gone when everything is done', () => {
    expect(todoHeadline([{ content: 'x', status: 'completed' }])).toBeNull();
  });
});
