import { describe, it, expect } from 'vitest';
import { pushInputHistory, getInputHistory } from '../src/platform/config.js';

// OpenCode's prompt history (component/prompt/history.tsx): what the person sent,
// newest last, capped at 50, a message sent twice in a row kept once.
describe('input history store', () => {
  it('keeps messages newest last, trimmed, without consecutive repeats, capped at 50', () => {
    const tag = `hist-${Date.now()}`;
    pushInputHistory(`  ${tag} one  `);
    pushInputHistory(`${tag} two`);
    pushInputHistory(`${tag} two`);
    pushInputHistory('   ');
    const all = getInputHistory();
    expect(all.at(-2)).toBe(`${tag} one`);
    expect(all.at(-1)).toBe(`${tag} two`);
    for (let i = 0; i < 55; i++) pushInputHistory(`${tag} n${i}`);
    const after = getInputHistory();
    expect(after.length).toBeLessThanOrEqual(50);
    expect(after.at(-1)).toBe(`${tag} n54`);
  });
});
