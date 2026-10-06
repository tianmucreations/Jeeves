import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { tellsPersonToContinue } from '../src/agent/loop.js';
import { bareCdTarget } from '../src/tools/runBash.js';
import { currentShellCwd, setShellCwd, expandPath } from '../src/platform/paths.js';

describe('a job never stops to ask the person to type "continue" (2 Oct)', () => {
  it('catches the exact wording from his screenshot ("type: continue fixing the lanes...")', () => {
    expect(
      tellsPersonToContinue(
        'The checker failed, so that file is NOT ready. Other routes look clean so far.\n\nTo carry on, type: continue fixing the lanes until the checker passes.'
      )
    ).toBe(true);
  });

  it('catches the common variants', () => {
    expect(tellsPersonToContinue('Done so far: three files fixed. Type continue to carry on.')).toBe(true);
    expect(tellsPersonToContinue('Half the lanes are fixed. Say the word and I will keep going.')).toBe(true);
    expect(tellsPersonToContinue('That is the state of play. Press continue when ready.')).toBe(true);
  });

  it('does not flag a job that genuinely finished', () => {
    expect(tellsPersonToContinue('All twelve routes now pass the sea checker. The map is saved and tagged.')).toBe(false);
    expect(tellsPersonToContinue('I will need the folder name to go further - which folder did you mean?')).toBe(false);
  });

  it('does not flag ordinary chat', () => {
    expect(tellsPersonToContinue('It is a savings account linked to your home loan.')).toBe(false);
  });
});

describe('the shell working directory carries over; a bare cd is silent and never asks (2 Oct)', () => {
  it('recognises a bare cd, with or without a target', () => {
    setShellCwd('/tmp');
    // path.resolve: on Windows the same folder is written with backslashes.
    expect(bareCdTarget('cd /private/tmp')).toBe(path.resolve('/private/tmp'));
    expect(bareCdTarget('cd "folder with spaces"')).toBe(expandPath('folder with spaces', '/tmp'));
    expect(bareCdTarget('cd')).toBe(expandPath('~'));
  });

  it('never treats a command that does more than change directory as a bare cd', () => {
    expect(bareCdTarget('cd /tmp && python3 check.py')).toBe(null);
    expect(bareCdTarget('cd /tmp; ls')).toBe(null);
    expect(bareCdTarget('cd /tmp | head')).toBe(null);
    expect(bareCdTarget('cd /tmp > out.txt')).toBe(null);
    expect(bareCdTarget('ls')).toBe(null);
    expect(bareCdTarget("cd ~/notes && cat note.txt <<'EOF'\nhello\nEOF")).toBe(null);
  });

  it('the remembered directory is what relative paths resolve against', () => {
    setShellCwd('/private/tmp');
    expect(currentShellCwd()).toBe('/private/tmp');
    setShellCwd(process.cwd());
  });
});
