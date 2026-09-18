import { describe, it, expect } from 'vitest';
import { wrapParagraph, clipLine, buildDisplayLines } from '../src/components/transcript-layout.js';
import type { TranscriptEntry } from '../src/state/session.js';

describe('wrapParagraph', () => {
  it('keeps short text on one line', () => {
    expect(wrapParagraph('hello world', 40)).toEqual(['hello world']);
  });
  it('wraps long text within the width', () => {
    const lines = wrapParagraph('word '.repeat(30).trim(), 20);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(line.length).toBeLessThanOrEqual(20);
  });
  it('hard-breaks unbreakable words', () => {
    const lines = wrapParagraph('a'.repeat(50), 20);
    expect(lines).toEqual(['a'.repeat(20), 'a'.repeat(20), 'a'.repeat(10)]);
  });
});

describe('clipLine', () => {
  it('keeps short text', () => {
    expect(clipLine('✓ Read src/app.tsx', 80)).toBe('✓ Read src/app.tsx');
  });
  it('clips long text to exactly one line', () => {
    const clipped = clipLine('x'.repeat(100), 30);
    expect(clipped.length).toBe(30);
    expect(clipped.endsWith('…')).toBe(true);
  });
});

describe('buildDisplayLines', () => {
  it('renders a user entry with a prompt prefix and wrapped continuation', () => {
    const entries: TranscriptEntry[] = [{ id: 1, kind: 'user', text: 'one two three four five six' }];
    const lines = buildDisplayLines(entries, 14);
    expect(lines[0].text.trimEnd()).toBe('> one two');
    expect(lines[1].text.trimEnd()).toBe('  three four');
    expect(lines.length).toBeGreaterThan(2);
    // The person's own lines carry the grey band, padded to the full width.
    expect(lines.every((line) => line.own && line.text.length === 14)).toBe(true);
  });

  it('leaves a blank line above each of the person\'s messages, except the very first', () => {
    const entries: TranscriptEntry[] = [
      { id: 1, kind: 'user', text: 'hello' },
      { id: 2, kind: 'assistant', text: 'Good day.' },
      { id: 3, kind: 'user', text: 'again' },
    ];
    const lines = buildDisplayLines(entries, 20);
    expect(lines.map((line) => line.text.trimEnd())).toEqual(['> hello', 'Good day.', '', '> again']);
    expect(lines[2].text).toBe(' ');
    expect(lines.map((line) => Boolean(line.own))).toEqual([true, false, false, true]);
  });

  it('renders each tool action as exactly one physical line', () => {
    const entries: TranscriptEntry[] = [
      { id: 1, kind: 'tool', data: { tool: 'readFile', summary: 'a'.repeat(200), state: 'done', label: `Read ${'b'.repeat(200)}` } },
    ];
    const lines = buildDisplayLines(entries, 80);
    expect(lines.length).toBe(1);
    expect(lines[0].text.length).toBeLessThanOrEqual(80);
    expect(lines[0].text.startsWith('✓ Read b')).toBe(true);
  });

  it('marks awaiting tool lines yellow and failures red', () => {
    const entries: TranscriptEntry[] = [
      { id: 1, kind: 'tool', data: { tool: 'writeFile', summary: 'x.txt', state: 'awaiting', label: '' } },
      { id: 2, kind: 'tool', data: { tool: 'runBash', summary: 'boom', state: 'failed', label: 'command not found' } },
    ];
    const lines = buildDisplayLines(entries, 80);
    expect(lines[0].color).toBe('yellow');
    expect(lines[0].text).toContain('allow? (y/n)');
    expect(lines[1].color).toBe('red');
    expect(lines[1].text).toContain('failed');
  });

  it('shows tools by their everyday names, never the internal ones', () => {
    const entries: TranscriptEntry[] = [
      { id: 1, kind: 'tool', data: { tool: 'writeFile', summary: 'notes.txt (12 characters)', state: 'awaiting', label: '' } },
      { id: 2, kind: 'tool', data: { tool: 'runBash', summary: 'npm test', state: 'running', label: '' } },
      { id: 3, kind: 'tool', data: { tool: 'runBash', summary: 'rm old.txt', state: 'declined', label: '' } },
      { id: 4, kind: 'tool', data: { tool: 'readFile', summary: 'x', state: 'failed', label: "couldn't find that file or folder" } },
    ];
    const text = buildDisplayLines(entries, 80).map((line) => line.text);
    expect(text).toEqual([
      '? Write notes.txt (12 characters) — allow? (y/n)',
      '… Run npm test',
      '✗ Run rm old.txt - you said no',
      "✗ Read failed: couldn't find that file or folder",
    ]);
    expect(text.join(' ')).not.toMatch(/writeFile|runBash|readFile|listDir/);
  });

  it('renders reasoning dim and errors red', () => {
    const entries: TranscriptEntry[] = [
      { id: 1, kind: 'reasoning', text: 'thinking aloud' },
      { id: 2, kind: 'error', text: 'something broke' },
    ];
    const lines = buildDisplayLines(entries, 80);
    expect(lines[0].dim).toBe(true);
    expect(lines[0].text).toBe('· thinking aloud');
    expect(lines[1].color).toBe('red');
  });
});