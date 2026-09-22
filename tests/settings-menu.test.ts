import { describe, it, expect } from 'vitest';
import { SETTINGS_ROWS, SETTINGS_ITEMS } from '../src/commands/settings.js';
import { session } from '../src/state/session.js';
import { runTurn } from '../src/agent/loop.js';

describe('the Settings menu data', () => {
  it('every item names a real slash command', () => {
    for (const item of SETTINGS_ITEMS) {
      expect(item.command.startsWith('/')).toBe(true);
      expect(item.label.length).toBeGreaterThan(2);
    }
  });

  it('groups items under at least one header, and every item follows some header', () => {
    expect(SETTINGS_ROWS.some((row) => row.kind === 'header')).toBe(true);
    let sawHeader = false;
    for (const row of SETTINGS_ROWS) {
      if (row.kind === 'header') sawHeader = true;
      if (row.kind === 'item') expect(sawHeader).toBe(true);
    }
  });

  it('covers the everyday commands the owner asked to have in one place', () => {
    const commands = SETTINGS_ITEMS.map((item) => item.command);
    for (const expected of ['/folder', '/model', '/keys', '/address', '/help']) {
      expect(commands).toContain(expected);
    }
  });
});

describe('opening the Settings screen', () => {
  it('/settings opens it, matching every other screen-opening command', async () => {
    session.closeSettings();
    await runTurn('/settings');
    expect(session.settingsOpen).toBe(true);
    session.closeSettings();
  });
});
