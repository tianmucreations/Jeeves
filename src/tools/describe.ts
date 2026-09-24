// A plain-English name for what a command does, for the question the person is
// asked: "Create folder ~/Documents/projects/test" instead of the raw command
// with its flags. Only confident, common shapes are translated - anything
// unusual keeps the raw command, so the question never lies about what will run
// (the honesty rule beats the wording rule).
import { extractHeredoc, splitOutsideQuotes } from '../agent/command-family.js';

function cleanPath(token: string): string {
  return token.replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1');
}

// Splits a stage into words, keeping quoted text whole: mkdir "my folder" is
// two words, not three.
function words(stage: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  for (const ch of stage) {
    if (quote) {
      current += ch;
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ' ' || ch === '\t') {
      if (current) out.push(current);
      current = '';
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

function describeStage(stage: string): string | null {
  const tokens = words(stage);
  if (tokens.length === 0) return null;
  const cmd = tokens[0];
  const paths = tokens.slice(1).filter((token) => !token.startsWith('-')).map(cleanPath);
  switch (cmd) {
    case 'mkdir':
      return paths.length > 0 ? `Create folder ${paths.join(', ')}` : null;
    case 'rmdir':
      return paths.length > 0 ? `Delete folder ${paths.join(', ')}` : null;
    case 'rm':
      return paths.length > 0 ? `Delete ${paths.join(', ')}` : null;
    case 'touch':
      return paths.length > 0 ? `Create file ${paths.join(', ')}` : null;
    case 'cp':
      return paths.length >= 2 ? `Copy ${paths[0]} to ${paths[paths.length - 1]}` : null;
    case 'mv':
      return paths.length >= 2 ? `Move ${paths[0]} to ${paths[paths.length - 1]}` : null;
    default:
      return null;
  }
}

// The first change the command would make, named in words: only write-shaped
// stages are described (a read-only stage after it, like the `ls -d` checks the
// model likes to append, changes nothing).
export function describeCommand(command: string): string {
  const trimmed = command.trim();
  const heredoc = extractHeredoc(trimmed);
  if (heredoc === 'malformed') return trimmed;
  const effective = typeof heredoc === 'string' ? heredoc : trimmed;
  for (const chain of splitOutsideQuotes(effective, '&&')) {
    for (const alternative of splitOutsideQuotes(chain, '||')) {
      for (const stage of splitOutsideQuotes(alternative, '|')) {
        const described = describeStage(stage.trim());
        if (described) return described;
      }
    }
  }
  return trimmed;
}

const PAST_TENSE: Record<string, string> = { Create: 'Created', Delete: 'Deleted', Copy: 'Copied', Move: 'Moved' };

// The record line after the command ran, in the same words.
export function describeDone(command: string): string {
  const described = describeCommand(command);
  const verb = /^(\w+)/.exec(described)?.[1] ?? '';
  if (PAST_TENSE[verb]) return described.replace(verb, PAST_TENSE[verb]);
  const firstLine = command.trim().split('\n')[0];
  return `Ran ${firstLine.length > 50 ? firstLine.slice(0, 49) + '…' : firstLine}`;
}
