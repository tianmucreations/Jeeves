import { session } from '../state/session.js';

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

// Read-only commands that never require permission (Claude Code's behaviour: reads
// never ask). A command qualifies only as a plain single command from this table -
// any shell metacharacter (pipes, redirects, substitutions, chaining) disqualifies
// it, because the metacharacter could turn a read into a write.
const READ_ONLY_COMMANDS = new Set([
  'pwd',
  'ls',
  'cat',
  'head',
  'tail',
  'wc',
  'file',
  'which',
  'whoami',
  'date',
  'echo',
]);

const READ_ONLY_TWO_WORD_COMMANDS = new Set([
  'git status',
  'git log',
  'git diff',
  'node --version',
  'npm --version',
]);

export function isReadOnlyBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  if (/[;|&><`$(){}\\\n]/.test(trimmed)) return false;
  const tokens = trimmed.split(/\s+/);
  if (tokens.length === 0) return false;
  if (READ_ONLY_COMMANDS.has(tokens[0])) return true;
  if (tokens.length >= 2 && READ_ONLY_TWO_WORD_COMMANDS.has(`${tokens[0]} ${tokens[1]}`)) return true;
  return false;
}

// Approvals are queued so that parallel tool calls never overwrite each other's prompt.
// The amber transcript prompt itself is rendered by the tool line in 'awaiting' state.
const queue: PendingApproval[] = [];

export function hasPendingApproval(): boolean {
  return queue.length > 0;
}

export function requestApproval(): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ resolve });
    if (queue.length === 1) {
      session.setActiveApproval();
    }
  });
}

export function answerApproval(approved: boolean): void {
  const current = queue.shift();
  if (!current) return;
  current.resolve(approved);
  if (queue.length > 0) {
    session.setActiveApproval();
  } else {
    session.clearActiveApproval();
  }
}