import { describe, it, expect } from 'vitest';
import { browserCommand, authorizeUrl } from '../src/providers/openrouter-signin.js';
import { copyNative } from '../src/ink/selection.js';
import { KEY_STORE, COPY_KEYS } from '../src/platform/wording.js';

// Run on Windows, Linux and macOS by the GitHub checks with every save.
describe('works the same on Windows, Linux and Mac (audit, 19 Sept)', () => {
  const url = authorizeUrl('http://localhost:1234/callback', 'abc');

  it('the sign-in address reaches the browser whole, & signs and all', () => {
    expect(url).toContain('&');
    for (const platform of ['darwin', 'win32', 'linux'] as const) {
      const [program, args] = browserCommand(url, platform);
      expect(args[args.length - 1], platform).toBe(url);
      expect(program, platform).not.toBe('cmd');
    }
    expect(browserCommand(url, 'win32')).toEqual(['rundll32', ['url,OpenURL', url]]);
  });

  it('the copy key and key store are named for this computer', () => {
    if (process.platform === 'darwin') expect([COPY_KEYS, KEY_STORE]).toEqual(['Cmd+C', 'your Mac keychain']);
    if (process.platform === 'win32') expect([COPY_KEYS, KEY_STORE]).toEqual(['Ctrl+Shift+C', 'Windows Credential Manager']);
    if (process.platform === 'linux') expect(COPY_KEYS).toBe('Ctrl+Shift+C');
  });

  it.runIf(process.platform === 'win32')('Windows: the clip program copies', async () => {
    expect(await copyNative('jeeves copy test')).toBe(true);
  }, 30_000);
});
