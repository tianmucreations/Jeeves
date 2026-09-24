import { session } from '../state/session.js';
import { trustProject, trustCommandFamily, isCommandFamilyTrusted } from './trust.js';
import { getAddress } from '../platform/config.js';
import { extractHeredoc, splitOutsideQuotes, commandFamilies } from './command-family.js';

interface PendingApproval {
  resolve: (approved: boolean) => void;
  // Whether "always allow in this project" may answer it: a change inside the
  // project folder. Spending questions and anything outside the folder never are.
  trustable: boolean;
  // For shell commands: the command itself, so "always allow this kind of
  // command" can remember its family for the project (Claude Code's saved
  // `Bash(prefix *)` rules, OpenCode's saved permission patterns).
  command?: string;
  // The few words naming the kind, for the button label (`wc`, `npm run`).
  familyLabel?: string | null;
}

// Pure-output commands that never require permission (the rule: harmless
// output must never prompt). A command is auto-approved only when every stage of
// it - across pipes, && and || - is one of the commands below, and the only
// redirection anywhere is to /dev/null. Anything that writes, deletes, installs,
// or reaches the network still prompts.
const READ_ONLY_COMMANDS = new Set([
  'yes',
  'head',
  'tail',
  'cat',
  'ls',
  'pwd',
  'wc',
  'file',
  'which',
  'whoami',
  'date',
  'echo',
  'printf',
  'seq',
  'sort',
  'uniq',
  'tr',
  'grep',
  'awk',
  'sed',
  'cut',
  'fold',
  'column',
  // The rest of Claude Code's built-in read-only set (code.claude.com/docs/en/
  // permissions): the same no-prompt classes the established agents run freely.
  'find',
  'du',
  'stat',
  'diff',
  'id',
  'uname',
  'hostname',
  'df',
  'ps',
  'basename',
  'dirname',
  'realpath',
  'readlink',
  'md5',
  'shasum',
  'md5sum',
  'sha256sum',
  'sha1sum',
  'cksum',
  'jq',
]);

// Multi-word commands where the words themselves are the read-only form.
const READ_ONLY_TWO_WORD_COMMANDS = new Set([
  'git status',
  'git log',
  'git diff',
  'node --version',
  'npm --version',
  'python --version',
  'python3 --version',
  'pip --version',
  'pip3 --version',
]);

// git branch lists branches when nothing but flags follows; any name argument
// would create, delete, or modify a branch, so only the listing form is allowed.
function isReadOnlyGitBranch(rest: string[]): boolean {
  return rest.every((token) => token.startsWith('-'));
}

// sed with -n only prints (the p command); -i edits files in place, and the w
// command writes files. The whole argument string is checked for a 'w' because
// scanning sed script syntax reliably is not worth the risk - a false "ask" is
// safe, a false "allow" is not.
function isReadOnlySed(rest: string[]): boolean {
  return rest.includes('-n') && !rest.some((token) => token === '-i' || token.startsWith('-i')) && !rest.join(' ').includes('w');
}

// awk reads input unless the program itself writes a file or runs a command;
// a | inside the program pipes to a command, so it disqualifies too.
function isReadOnlyAwk(rest: string[]): boolean {
  const program = rest.join(' ');
  return !program.includes('system(') && !program.includes('>') && !program.includes('|') && !program.includes('getline');
}

// find reads and prints unless asked to execute or delete: -exec/-execdir run
// programs, -ok/-okdir ask then run, -delete removes, -fls/-fprint* write files.
function isReadOnlyFind(rest: string[]): boolean {
  const banned = ['-exec', '-execdir', '-ok', '-okdir', '-delete', '-fls'];
  return !rest.some((token) => banned.includes(token) || token.startsWith('-fprint'));
}

function isReadOnlyStage(tokens: string[], isFinalStage: boolean): boolean {
  if (tokens.length === 0) return false;
  const command = tokens[0];
  const rest = tokens.slice(1);
  if (command === 'git') {
    if (rest.length === 0) return false;
    if (READ_ONLY_TWO_WORD_COMMANDS.has(`git ${rest[0]}`)) return true;
    if (rest[0] === 'branch') return isReadOnlyGitBranch(rest.slice(1));
    return false;
  }
  if (command === 'node' || command === 'npm') {
    return rest.length === 1 && rest[0] === '--version';
  }
  if (command === 'sed') return isReadOnlySed(rest);
  if (command === 'awk') return isReadOnlyAwk(rest);
  if (command === 'find') return isReadOnlyFind(rest);
  if (command === 'yes') {
    // yes on its own streams forever; it qualifies only feeding a pipe that ends.
    return !isFinalStage;
  }
  return READ_ONLY_COMMANDS.has(command);
}

// One pipe stage: tokens with any /dev/null redirection stripped. Redirection to
// any other target disqualifies the whole command.
function parseStage(stage: string): { tokens: string[] } | null {
  const tokens: string[] = [];
  const parts = stage.trim().split(/\s+/).filter((part) => part.length > 0);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    // Forms: > /dev/null, 2> /dev/null, &> /dev/null, < /dev/null, and the
    // no-space variants. Redirection to any other target disqualifies.
    if (/^(\d*)>$|^&>$|^<$/.test(part) || /^(?:\d*>|&>|<)\/dev\/null$/.test(part)) {
      const target = /^(?:\d*>|&>|<)\/dev\/null$/.test(part) ? part.replace(/^(?:\d*>|&>|<)/, '') : parts[++i];
      if (target !== '/dev/null') return null;
      continue;
    }
    // Any other redirect or input form is a write or an unknown - disqualify.
    if (/[<>]/.test(part)) return null;
    tokens.push(part);
  }
  return { tokens };
}

// Splits on a separator character, ignoring quoted text, so a pipe inside quotes
// (awk '{print $1 | "sort"}') never counts as a shell pipe. splitOutsideQuotes
// and the heredoc helpers live in command-family.ts, shared with the command-kind
// logic so both judge exactly the same shape of command.

// True when the command is composed entirely of read-only stages: pipes, && and
// || chains of allowlisted commands, with redirection to /dev/null only. Anything
// else - writes, deletes, installs, network, substitutions, semicolons - is false.
export function isReadOnlyBashCommand(command: string): boolean {
  const trimmed = command.trim();
  if (trimmed.length === 0) return false;
  // Substitution constructs can turn any read into a write - and "$(...)" inside
  // double quotes still executes - so any of these disqualifies outright. Checked
  // on the whole text INCLUDING heredoc lines: an unquoted heredoc body is
  // expanded by the shell, so a backtick or $( in it would execute.
  if (trimmed.includes('`') || trimmed.includes('$(')) return false;
  const heredoc = extractHeredoc(trimmed);
  if (heredoc === 'malformed') return false;
  const effective = typeof heredoc === 'string' ? heredoc : trimmed;
  if (/[;\n]/.test(stripQuotes(effective))) return false;
  for (const chain of splitOutsideQuotes(effective, '&&')) {
    for (const alternative of splitOutsideQuotes(chain, '||')) {
      const stages = splitOutsideQuotes(alternative, '|');
      for (let i = 0; i < stages.length; i++) {
        const parsed = parseStage(stages[i]);
        if (parsed === null) return false;
        if (!isReadOnlyStage(parsed.tokens, i === stages.length - 1)) return false;
      }
    }
  }
  return true;
}

// Replaces quoted spans with empty quoted strings, so metacharacter checks see
// only what the shell will actually interpret. Shared with the runBash tool.
export function stripQuotes(text: string): string {
  return text.replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''");
}

// Approvals are queued so that parallel tool calls never overwrite each other's prompt.
// The amber transcript prompt itself is rendered by the tool line in 'awaiting' state.
const queue: PendingApproval[] = [];

export function hasPendingApproval(): boolean {
  return queue.length > 0;
}

export function requestApproval(options: { trustable?: boolean; command?: string } = {}): Promise<boolean> {
  return new Promise((resolve) => {
    const families = options.command ? commandFamilies(options.command) : [];
    queue.push({
      resolve,
      trustable: options.trustable === true,
      command: options.command,
      familyLabel: options.command ? (families.length === 1 ? families[0] : families.length > 1 ? 'these commands' : null) : null,
    });
    if (queue.length === 1) {
      session.setActiveApproval();
    }
  });
}

// Whether the question now on screen may be answered with "always allow".
export function currentApprovalTrustable(): boolean {
  return queue[0]?.trustable === true;
}

// The kind of the command now awaiting an answer (`wc`, `npm run`), for the
// "always allow this kind" button; null when the question is not a command.
export function currentApprovalFamily(): string | null {
  return queue[0]?.familyLabel ?? null;
}

// scope "project": "always allow in this project" - approves this change, every
// other change inside the project already waiting, and all future ones in this
// folder (still backed up, so /undo works).
// scope "command": "always allow this kind of command" - remembers the command's
// family for this project, so no command of the same kind asks again here (as
// Claude Code saves a per-repo `Bash(prefix *)` rule and OpenCode saves the
// pattern per project). Other questions already waiting whose command is now
// covered by that memory are answered too.
export function answerApproval(approved: boolean, scope: 'once' | 'project' | 'command' = 'once'): void {
  const current = queue.shift();
  if (!current) return;
  if (approved && scope === 'project' && current.trustable) {
    trustProject();
    session.addNotice(`From now on I won't ask before changing things in this project folder, ${getAddress() ?? 'Sir'} - every change is still backed up, so /undo puts it back. I'll still ask about anything outside it. Type /ask to have me ask every time again.`);
    for (let i = queue.length - 1; i >= 0; i--) {
      if (queue[i].trustable) queue.splice(i, 1)[0].resolve(true);
    }
  }
  if (approved && scope === 'command' && current.command) {
    trustCommandFamily(current.command);
    session.addNotice(`Got it - I won't ask about ${current.familyLabel ?? 'that kind of'} command${current.familyLabel && current.familyLabel !== 'these commands' ? 's' : ''} in this folder again, ${getAddress() ?? 'Sir'}. Type /ask to have me ask every time.`);
    for (let i = queue.length - 1; i >= 0; i--) {
      const waiting = queue[i];
      if (waiting.command && isCommandFamilyTrusted(waiting.command)) queue.splice(i, 1)[0].resolve(true);
    }
  }
  current.resolve(approved);
  if (queue.length > 0) {
    session.setActiveApproval();
  } else {
    session.clearActiveApproval();
  }
}
