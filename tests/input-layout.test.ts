import { describe, it, expect } from 'vitest';
import { inputView, dropLastChar } from '../src/components/input-layout.js';

describe('inputView', () => {
  it('shows short text whole, cursor right after it', () => {
    expect(inputView('hello', 76)).toEqual({ text: 'hello', trailingSpaces: '', width: 5 });
  });
  it('splits trailing spaces off so they render differently from padding', () => {
    const plain = inputView('hello', 76);
    const spaced = inputView('hello  ', 76);
    expect(spaced).toEqual({ text: 'hello', trailingSpaces: '  ', width: 7 });
    expect(spaced.width).not.toBe(plain.width);
  });
  it('counts wide characters as two columns', () => {
    expect(inputView('日本', 76).width).toBe(4);
  });
  it('shows only the tail of text wider than the row, leaving a column for the cursor', () => {
    const long = 'abcdefghij'.repeat(10);
    const view = inputView(long, 20);
    expect(view.width).toBe(19);
    expect(view.text).toBe(long.slice(-19));
  });
  it('every added character changes the drawn row whenever the cursor column moves', () => {
    // Ink trims nothing we can rely on: a plain trailing space looks exactly like
    // the row's padding, so the drawn row is (text without trailing spaces, styled
    // trailing run). If the cursor moves while that pair is unchanged, Ink takes its
    // cursor-only path and draws the cursor on the separator.
    let prev = inputView('', 20);
    let value = '';
    for (const ch of 'the quick  brown fox jumps over the lazy dog   ') {
      value += ch;
      const next = inputView(value, 20);
      expect(next.text).not.toMatch(/ $/);
      const sameRow = next.text === prev.text && next.trailingSpaces === prev.trailingSpaces;
      if (next.width !== prev.width) expect(sameRow).toBe(false);
      prev = next;
    }
  });
  it('never splits a wide character at the left edge', () => {
    const view = inputView('日本語日本語', 6);
    expect(view.width).toBeLessThanOrEqual(5);
    expect(view.text).toBe('本語');
  });
});

describe('dropLastChar', () => {
  it('removes a whole character, including astral ones', () => {
    expect(dropLastChar('ab')).toBe('a');
    expect(dropLastChar('a😀')).toBe('a');
    expect(dropLastChar('')).toBe('');
  });
});
