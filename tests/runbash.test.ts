import { describe, it, expect } from 'vitest';
import { runRunBash } from '../src/tools/runBash.js';
import { killAllRunningCommands } from '../src/tools/runBash.js';

describe('runBash hangs never lock the app', () => {
  it('runs a normal command and reports its output', async () => {
    const result = await runRunBash({ command: 'printf "hello"' });
    expect(result).toContain('$ printf "hello"');
    expect(result).toContain('hello');
    expect(result).toContain('exit code: 0');
  });

  it('gives a command that reads stdin an immediate end-of-file instead of a hang', async () => {
    // Bare cat with no file would wait for keyboard input forever; with stdin
    // coming from /dev/null it reads end-of-file and exits at once.
    const started = Date.now();
    // Windows runs PowerShell, where "cat" means something else; reading all of the
    // input is the same test there.
    const result = await runRunBash({ command: process.platform === 'win32' ? '[Console]::In.ReadToEnd()' : 'cat' });
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(result).toContain('exit code: 0');
    expect(result).not.toContain('stdout:\n0');
  });

  it('refuses full-screen interactive programs with a plain-English message', async () => {
    for (const command of ['less', 'more file.txt', 'vim notes.md', 'git log | less', 'top']) {
      await expect(runRunBash({ command })).rejects.toThrow(/needs an interactive terminal/);
    }
  });

  it('does not refuse commands that merely mention similar words', async () => {
    const result = await runRunBash({ command: 'printf "vim is an editor"' });
    expect(result).toContain('exit code: 0');
    await expect(runRunBash({ command: 'cat "my less notes.txt" || true' })).resolves.toBeTruthy();
  });

  it('judges the command, not the heredoc text, for interactive programs', async () => {
    // Ordinary English words in heredoc text must never read as programs
    // (part of the Spain fix, 24 Sept: prose in a heredoc is normal).
    const result = await runRunBash({ command: "wc -w <<'EOF'\nmore details on top of less\nEOF" });
    expect(result).toContain('exit code: 0');
    expect(result).not.toContain('interactive');
  });

  it('kills a running command when the app exits', async () => {
    const slow = runRunBash({ command: 'sleep 30' });
    killAllRunningCommands();
    // The command dies (signal or exit), the promise settles, and nothing hangs.
    const result = await slow;
    expect(result).toContain('exit code:');
    expect(result).not.toContain('exit code: 0');
  }, 20_000);
});
