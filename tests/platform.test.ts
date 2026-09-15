import { describe, it, expect } from 'vitest';
import { getShell } from '../src/platform/shell.js';

describe('shell adapter', () => {
  it('selects PowerShell on Windows', () => {
    const shell = getShell('win32');
    expect(shell.program).toBe('powershell.exe');
    expect(shell.flag).toBe('-Command');
  });

  it('selects bash on macOS', () => {
    const shell = getShell('darwin');
    expect(shell.program).toBe('bash');
    expect(shell.flag).toBe('-c');
  });

  it('selects bash on Linux', () => {
    const shell = getShell('linux');
    expect(shell.program).toBe('bash');
    expect(shell.flag).toBe('-c');
  });

  it('defaults to the current platform', () => {
    const expected = getShell(process.platform);
    expect(getShell()).toEqual(expected);
  });
});