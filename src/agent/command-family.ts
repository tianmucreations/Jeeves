// The "kind" of a shell command, in the few words a person would use to name it.
// Approving one command can then remember its kind for the project - approve
// `wc -w draft.txt` once and no `wc` command asks again in that folder. This is
// the same idea as OpenCode's command-prefix arity table (packages/opencode/src/
// permission/arity.ts, "the human-understandable command") and Claude Code's
// saved `Bash(prefix *)` rules - the reason those tools stop asking after the
// first turn in a project.
//
// The file also carries the shared command-text helpers (heredoc removal and
// quote-aware splitting) so both the read-only allowlist and the family logic
// judge exactly the same shape of command.

// How many words after the program name are part of what the command IS.
// `git status` is a kind of its own; `npm run dev` names the script; `rm`
// covers everything rm does. Flags never extend the kind.
const SUBCOMMAND_WORDS: Record<string, number> = {
  git: 1,
  npm: 1,
  'npm run': 2,
  'npm test': 1,
  'npm install': 1,
  npx: 1,
  yarn: 1,
  'yarn run': 2,
  pnpm: 1,
  'pnpm run': 2,
  bun: 1,
  'bun run': 2,
  pip: 1,
  pip3: 1,
  cargo: 1,
  'cargo run': 2,
  brew: 1,
  docker: 1,
  'docker compose': 2,
  kubectl: 1,
  terraform: 1,
  go: 1,
  make: 1,
  aws: 2,
  gcloud: 1,
  az: 1,
  dotnet: 1,
  bundle: 1,
  gem: 1,
  composer: 1,
  flutter: 1,
};

// Splits on a separator character, ignoring quoted text, so a pipe inside quotes
// (awk '{print $1 | "sort"}') never counts as a shell pipe.
export function splitOutsideQuotes(text: string, separator: string): string[] {
  const parts: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quote) {
      current += char;
      if (char === quote) quote = null;
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      current += char;
      continue;
    }
    if (text.startsWith(separator, i)) {
      parts.push(current);
      current = '';
      i += separator.length - 1;
      continue;
    }
    current += char;
  }
  parts.push(current);
  return parts;
}

// A heredoc (command <<TAG, some text lines, then TAG alone on a line) feeds
// those lines to the command as plain data. The data is never interpreted as a
// command - with a quoted tag it is not expanded at all, and an unquoted tag
// expands only parameters, never commands (substitutions are banned on the
// whole command string before this runs). One well-formed heredoc is therefore
// as harmless as the command it feeds, and the text is removed before the usual
// checks so its newlines and everyday words cannot disguise the command or trip
// the interactive-program refusal.
// Returns the command without the heredoc, null when there is no heredoc, or
// 'malformed' when one is present but cannot be proven clean (then: prompt).
export function extractHeredoc(command: string): string | null | 'malformed' {
  const firstLineEnd = command.indexOf('\n');
  const firstLine = firstLineEnd === -1 ? command : command.slice(0, firstLineEnd);
  let operatorAt = -1;
  let quote: '"' | "'" | null = null;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === '<' && firstLine[i + 1] === '<') {
      operatorAt = i;
      break;
    }
  }
  if (operatorAt === -1) return null;
  let at = operatorAt + 2;
  const dash = firstLine[at] === '-';
  if (dash) at++;
  while (firstLine[at] === ' ') at++;
  let tag = '';
  if (firstLine[at] === '"' || firstLine[at] === "'") {
    const end = firstLine.indexOf(firstLine[at], at + 1);
    if (end === -1) return 'malformed';
    tag = firstLine.slice(at + 1, end);
    at = end + 1;
  } else {
    while (at < firstLine.length && !/[\s;&|<>()]/.test(firstLine[at])) {
      tag += firstLine[at];
      at++;
    }
  }
  if (tag.length === 0) return 'malformed';
  // Anything on the command line after the tag (a pipe, a second heredoc) cannot
  // be proven to treat the text as data - so it keeps prompting.
  if (firstLine.slice(at).trim() !== '') return 'malformed';
  const body = firstLineEnd === -1 ? [] : command.slice(firstLineEnd + 1).split('\n');
  const closeAt = body.findIndex((line) => (dash ? line.replace(/^\t+/, '') : line) === tag);
  if (closeAt === -1) return 'malformed';
  if (body.slice(closeAt + 1).some((line) => line.trim() !== '')) return 'malformed';
  return firstLine.slice(0, operatorAt).trim();
}

// The command with any well-formed heredoc removed (the original otherwise).
// Shared with the interactive-program refusal, which must judge the command,
// never the heredoc's prose.
export function stripHeredoc(command: string): string {
  const extracted = extractHeredoc(command.trim());
  return typeof extracted === 'string' ? extracted : command.trim();
}

// The kind of one command stage: `wc -w notes.txt` is `wc`, `git status` is
// `git status`, `npm run dev` is `npm run dev`, `rm -rf build` is `rm`.
export function commandFamily(stage: string): string {
  const tokens = stage
    .replace(/(?:\d*&?>|&>|\d*&|<)\s*\/dev\/null/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 0 && !/[<>]/.test(token) && token !== '/dev/null');
  if (tokens.length === 0) return '';
  const second = tokens.length > 1 && !tokens[1].startsWith('-') ? `${tokens[0]} ${tokens[1]}` : '';
  const extra = second !== '' && second in SUBCOMMAND_WORDS ? SUBCOMMAND_WORDS[second] : SUBCOMMAND_WORDS[tokens[0]] ?? 0;
  const words = [tokens[0]];
  let taken = 0;
  for (const token of tokens.slice(1)) {
    if (taken >= extra) break;
    if (token.startsWith('-')) continue;
    words.push(token);
    taken += 1;
  }
  return words.join(' ');
}

// The kinds of every stage of a command, across pipes, && and || chains -
// remembering one approval covers each part separately, as Claude Code saves a
// rule per subcommand.
export function commandFamilies(command: string): string[] {
  const trimmed = command.trim();
  const heredoc = extractHeredoc(trimmed);
  if (heredoc === 'malformed') return [];
  const effective = typeof heredoc === 'string' ? heredoc : trimmed;
  const families = new Set<string>();
  for (const chain of splitOutsideQuotes(effective, '&&')) {
    for (const alternative of splitOutsideQuotes(chain, '||')) {
      for (const stage of splitOutsideQuotes(alternative, '|')) {
        const family = commandFamily(stage);
        if (family !== '') families.add(family);
      }
    }
  }
  return [...families];
}
