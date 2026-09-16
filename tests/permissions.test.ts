import { describe, it, expect } from 'vitest';
import { isReadOnlyBashCommand } from '../src/agent/permissions.js';

describe('read-only bash allowlist', () => {
  it('allows the plain read-only commands', () => {
    for (const command of [
      'pwd',
      'ls',
      'ls -la',
      'cat README.md',
      'head -20 src/index.ts',
      'tail -5 package.json',
      'wc -l dist/index.js',
      'file bin/jeeves',
      'which node',
      'whoami',
      'date',
      'echo hello',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(true);
    }
  });

  it('allows the two-word read-only commands with extra arguments', () => {
    for (const command of [
      'git status',
      'git status --short',
      'git log',
      'git log --oneline -5',
      'git diff',
      'git diff --stat',
      'node --version',
      'npm --version',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(true);
    }
  });

  it('still prompts for writes, deletes, installs, and network', () => {
    for (const command of [
      'rm -rf /',
      'touch newfile',
      'mkdir build',
      'npm install left-pad',
      'curl https://example.com',
      'git push',
      'git commit -m x',
      'node script.js',
      'npm test',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(false);
    }
  });

  it('disqualifies anything with shell metacharacters, even on allowed commands', () => {
    for (const command of [
      'echo hi > file.txt',
      'cat a | sh',
      'ls; rm -rf /',
      'echo $(whoami)',
      'ls `pwd`',
      'echo hi && rm x',
      'ls > out.txt',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(false);
    }
  });

  it('rejects empty and whitespace-only commands', () => {
    expect(isReadOnlyBashCommand('')).toBe(false);
    expect(isReadOnlyBashCommand('   ')).toBe(false);
  });
});
