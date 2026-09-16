import { describe, it, expect } from 'vitest';
import { wrapParagraph, clipLine, buildDisplayLines, visibleWindow } from '../src/components/transcript-layout.js';
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

describe('visibleWindow', () => {
  const lines = (count: number) => Array.from({ length: count }, (_, i) => ({ text: `line ${i}` }));

  it('follows the newest lines when scroll offset is zero', () => {
    const result = visibleWindow(lines(30), 10, 0);
    expect(result.visible.map((l) => l.text)).toEqual(Array.from({ length: 10 }, (_, i) => `line ${20 + i}`));
    expect(result.linesAbove).toBe(20);
    expect(result.linesBelow).toBe(0);
  });

  it('scrolls up by the requested number of lines', () => {
    const result = visibleWindow(lines(30), 10, 5);
    expect(result.visible[0].text).toBe('line 15');
    expect(result.visible[9].text).toBe('line 24');
    expect(result.linesAbove).toBe(15);
    expect(result.linesBelow).toBe(5);
  });

  it('clamps the offset so the view can never sink past the newest or rise past the oldest', () => {
    expect(visibleWindow(lines(30), 10, 999).visible[0].text).toBe('line 0');
    expect(visibleWindow(lines(5), 10, 3).linesAbove).toBe(0);
    expect(visibleWindow(lines(5), 10, 3).visible).toHaveLength(5);
  });
});

describe('buildDisplayLines', () => {
  it('renders a user entry with a prompt prefix and wrapped continuation', () => {
    const entries: TranscriptEntry[] = [{ id: 1, kind: 'user', text: 'one two three four five six' }];
    const lines = buildDisplayLines(entries, 14);
    expect(lines[0].text).toBe('> one two');
    expect(lines[1].text).toBe('  three four');
    expect(lines.length).toBeGreaterThan(2);
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