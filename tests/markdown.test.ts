import { describe, it, expect } from 'vitest';
import { renderMarkdown } from '../src/components/markdown.js';
import { wrapStyled, buildDisplayLines } from '../src/components/transcript-layout.js';

// The owner's screenshot, 19 Sept: raw ** everywhere in the terminal.
const answer = `**3. Funeral home management software**

- **Proof they pay:** vendors charge $500–$5,000 just to set you up.
- **The opening:** fragmented trade, "clunky on the backend".

One honest caution: these are not small add-ons like your \`Jira\` apps. My verdict: ~100 shops.`;

describe('answers drawn as formatting, never as stray marks', () => {
  it('removes every ** and ## and keeps the words', () => {
    const { text } = renderMarkdown(answer);
    expect(text).not.toContain('**');
    expect(text).not.toContain('`');
    expect(text).toContain('3. Funeral home management software');
    expect(text).toContain('- Proof they pay: vendors charge $500–$5,000 just to set you up.');
    expect(text).toContain('"clunky on the backend"');
    expect(text).toContain('~100 shops'); // ~ is "about", not strikethrough
  });

  it('marks exactly the bold words as bold', () => {
    const { text, spans } = renderMarkdown(answer);
    const bold = spans.filter((s) => s.bold).map((s) => text.slice(s.from, s.to));
    expect(bold).toEqual(['3. Funeral home management software', 'Proof they pay:', 'The opening:']);
    const code = spans.filter((s) => s.code).map((s) => text.slice(s.from, s.to));
    expect(code).toEqual(['Jira']);
  });

  it('headings lose their # marks and turn bold', () => {
    const { text, spans } = renderMarkdown('## What I found\n\nThree gaps.');
    expect(text).toBe('What I found\n\nThree gaps.');
    expect(text.slice(spans[0].from, spans[0].to)).toBe('What I found');
  });

  it('keeps bold on the right words when a line wraps', () => {
    const { text, spans } = renderMarkdown('The **quick brown fox** jumps over the lazy dog');
    const lines = wrapStyled(text, spans, 16);
    expect(lines.map((l) => l.text)).toEqual(['The quick brown', 'fox jumps over', 'the lazy dog']);
    expect(lines.map((l) => l.spans.map((s) => l.text.slice(s.from, s.to)))).toEqual([['quick brown'], ['fox'], []]);
  });

  it('wrapped list lines start under the words, and blank lines keep their height', () => {
    const { text, spans } = renderMarkdown('## Tips\n\n- **Keep a regular hour.** Retire and rise at the same time');
    const lines = wrapStyled(text, spans, 24);
    expect(lines.map((l) => l.text)).toEqual(['Tips', ' ', '- Keep a regular hour.', '  Retire and rise at the', '  same time']);
    expect(lines[2].spans.map((s) => lines[2].text.slice(s.from, s.to))).toEqual(['Keep a regular hour.']);
  });

  it('the transcript shows the answer without marks', () => {
    const lines = buildDisplayLines([{ id: 1, kind: 'assistant', text: answer }], 80);
    expect(lines.map((l) => l.text).join('\n')).not.toMatch(/\*\*|`/);
  });
});
