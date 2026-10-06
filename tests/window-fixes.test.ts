import { describe, it, expect } from 'vitest';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { getFavorites, setFavorites, settingsFolder } from '../src/platform/config.js';

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

