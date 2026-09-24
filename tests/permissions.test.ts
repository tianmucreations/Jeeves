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
      'printf "%s lines\\n" 5',
      'seq 1 10',
      'sort names.txt',
      'uniq -c counts.txt',
      'tr a-z A-Z < /dev/null',
      'grep -i error app.log',
      "cut -d, -f1 data.csv",
      'fold -w 80 readme.txt',
      'column -t table.txt',
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
      'git branch',
      'git branch -a',
      'node --version',
      'npm --version',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(true);
    }
  });

  it('allows pipes and chains of purely read-only stages', () => {
    for (const command of [
      'yes 0 | head -n 500',
      'cat a.txt | grep foo | wc -l',
      'seq 1 100 | sort -r | head -3',
      'git status && git log --oneline',
      'cat missing.txt || echo gone',
      'grep -c foo big.log | sort | uniq',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(true);
    }
  });

  it('allows redirection to /dev/null only', () => {
    for (const command of [
      'grep foo big.log > /dev/null',
      'grep foo big.log 2> /dev/null',
      'grep foo big.log >/dev/null',
      'cat a.txt | grep foo > /dev/null',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(true);
    }
  });

  it('allows the guarded forms of sed and awk', () => {
    for (const command of [
      "sed -n '1,5p' notes.md",
      'sed -n 1,5p notes.md',
      "awk '{print $1}' data.tsv",
      "awk '{print $2, $5}' data.tsv",
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(true);
    }
  });

  it('still prompts for writes, deletes, installs, and network', () => {
    for (const command of [
      'rm -rf /',
      'touch newfile',
      'mkdir build',
      'mv a b',
      'chmod +x script',
      'sudo ls',
      'npm install left-pad',
      'curl https://example.com',
      'wget https://example.com/f',
      'git push',
      'git commit -m x',
      'git branch feature-x',
      'git branch -d old',
      'node script.js',
      'npm test',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(false);
    }
  });

  it('still prompts for write-shaped sed and awk programs', () => {
    for (const command of [
      'sed -i s/a/b/ file.txt',
      "sed -n '1,5w out.txt' notes.md",
      "awk '{print > \"out.txt\"}' data.tsv",
      "awk '{system(\"rm x\")}' data.tsv",
      "awk 'BEGIN { while ((getline line < \"/etc/passwd\") > 0) print line }'",
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(false);
    }
  });

  it('still prompts for redirection anywhere other than /dev/null', () => {
    for (const command of [
      'echo hi > file.txt',
      'echo hi >> log.txt',
      'ls > out.txt',
      'cat a | grep b > results.txt',
      'grep foo log 2>&1',
      'cat < input.txt',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(false);
    }
  });

  it('disqualifies substitution and sequencing constructs, even on allowed commands', () => {
    for (const command of [
      'cat a | sh',
      'ls; rm -rf /',
      'echo $(whoami)',
      'ls `pwd`',
      'echo "$(rm -rf x)"',
      'echo hi && rm x',
      'cat a | grep b; pwd',
      "awk '{print $1 | \"sort\"}' data.tsv",
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(false);
    }
  });

  it('never auto-runs yes on its own - only feeding a pipe', () => {
    expect(isReadOnlyBashCommand('yes')).toBe(false);
    expect(isReadOnlyBashCommand('yes 0')).toBe(false);
    expect(isReadOnlyBashCommand('yes | tail -1')).toBe(true);
  });

  it('allows a heredoc feeding plain text to a read-only command - never asks (the Spain bug, 24 Sept)', () => {
    for (const command of [
      "wc -w <<'EOF'\nSpain occupies most of the Iberian Peninsula.\nEOF",
      'wc -w <<EOF\nhello world\nEOF',
      "cat <<'EOF'\nsome text to hold\nEOF",
      "wc -l <<'END'\ntwo\nlines\nEND",
      "sort <<'EOF'\nb\na\nEOF",
      "head -3 <<'EOF'\nx\ny\nz\nEOF",
      "wc -w <<-'EOF'\nindented body\n\tEOF",
      "grep -c a <<'EOF'\nbanana\nbandana\nEOF",
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(true);
    }
  });

  it('still prompts when a heredoc is malformed or the command is not read-only', () => {
    for (const command of [
      'bash <<EOF\nrm -rf /\nEOF',
      "sh <<'EOF'\nanything\nEOF",
      "wc -w <<'EOF'\nnever terminated",
      "cat <<'EOF'\nbody\nEOF\nrm x",
      'wc -w <<A <<B\nx\nA\nB',
      "wc -w <<'EOF' | tail -1\nx\nEOF",
      'cat <<EOF\nbacktick `pwd` in an unquoted body\nEOF',
      'cat <<EOF\n$(rm -rf x) in an unquoted body\nEOF',
      'yes <<EOF\nforever\nEOF',
    ]) {
      expect(isReadOnlyBashCommand(command), command).toBe(false);
    }
  });

  it('rejects empty and whitespace-only commands', () => {
    expect(isReadOnlyBashCommand('')).toBe(false);
    expect(isReadOnlyBashCommand('   ')).toBe(false);
  });
});
