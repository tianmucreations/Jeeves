import { describe, it, expect } from 'vitest';
import { MouseFilter } from '../src/ink/stdin-filter.js';
import { session } from '../src/state/session.js';

// 26 Sept: "[<65;36;13M" kept turning up in the typing box. The terminal writes a wheel
// report in one piece, but the operating system can hand it over in two.
describe('mouse reports are taken out of the keyboard stream', () => {
  const seq = '\x1b[<65;36;13M';
  const run = (pieces: string[]) => {
    const filter = new MouseFilter();
    const got: string[] = [];
    const text = pieces.map((piece) => filter.push(piece, (report) => got.push(report))).join('');
    return { text, got, filter };
  };

  it('a whole report, or many in one chunk, never reaches the text', () => {
    expect(run([seq])).toMatchObject({ text: '', got: [seq] });
    expect(run([seq.repeat(5)])).toMatchObject({ text: '', got: Array(5).fill(seq) });
    expect(run([`hi${seq}there`])).toMatchObject({ text: 'hithere', got: [seq] });
  });

  it('a report cut at ANY point is put back together', () => {
    for (let cut = 1; cut < seq.length; cut++) {
      const { text, got } = run([seq.slice(0, cut), seq.slice(cut)]);
      expect(text, `cut at ${cut}`).toBe('');
      expect(got, `cut at ${cut}`).toEqual([seq]);
    }
  });

  it('ordinary keys and arrow sequences pass straight through', () => {
    expect(run(['hello'])).toMatchObject({ text: 'hello', got: [] });
    expect(run(['\x1b[A'])).toMatchObject({ text: '\x1b[A', got: [] });
    expect(run(['\x1b[1;5D'])).toMatchObject({ text: '\x1b[1;5D', got: [] });
  });

  it('a lone Escape is held (it may be the front of a report) and can be released as the key', () => {
    const { text, filter } = run(['\x1b']);
    expect(text).toBe('');
    expect(filter.holding()).toBe(true);
    expect(filter.release()).toEqual({ text: '\x1b', mouse: false });
  });

  it('a report that lost its Escape at the start of a chunk is still recognised', () => {
    expect(run(['[<65;36;13M'])).toMatchObject({ text: '', got: ['[<65;36;13M'] });
  });
});

describe('streaming words redraw the window at most about twenty times a second', () => {
  it('stores every word at once but tells the screen rarely', async () => {
    let redraws = 0;
    const unsubscribe = session.subscribe(() => void redraws++);
    const id = session.startAssistant();
    redraws = 0;
    for (let i = 0; i < 200; i++) session.appendToken(id, 'word ');
    expect(session.transcript.find((e) => e.id === id && e.kind === 'assistant')).toMatchObject({ text: 'word '.repeat(200) });
    expect(redraws).toBeLessThan(5);
    await new Promise((r) => setTimeout(r, 120));
    expect(redraws).toBeGreaterThanOrEqual(1);
    unsubscribe();
    session.finishAssistant(id);
  });
});
