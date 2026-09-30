import { readFile, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { z } from 'zod';
import { resolveFromCwd } from '../platform/paths.js';
import { PlainError } from './plain.js';
import { ignorePatterns } from './listDir.js';

// Finding things in a folder without reading everything, as both Claude Code (Grep, Glob) and OpenCode
// (grep, glob) do: search INSIDE files for words, and find files BY NAME. They use ripgrep, a separate
// program; this does the same job in Jeeves itself so nothing has to be installed on any computer.
// Same limits as OpenCode's grep: at most 100 matches, said plainly when there are more.
const MAX_MATCHES = 100;
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_LINE_CHARS = 200;

export const searchFilesSchema = z.object({
  pattern: z.string().min(1).describe('The words to look for inside files (a regular expression is fine, e.g. "invoice.*2026")'),
  path: z.string().optional().describe('The folder to search in. Default: the folder Jeeves is working in.'),
  include: z.string().optional().describe('Only files with names like this, e.g. "*.txt" or "*.{ts,tsx}"'),
  ignoreCase: z.boolean().optional().describe('true: capital and small letters count the same'),
});

export const findFilesSchema = z.object({
  pattern: z.string().min(1).describe('The file names to find, with * as a wildcard, e.g. "*.pdf" or "reports/**/*2026*.xlsx"'),
  path: z.string().optional().describe('The folder to look in. Default: the folder Jeeves is working in.'),
});

function folderFor(input: string | undefined): string {
  const dir = resolveFromCwd(input ?? '.');
  if (!existsSync(dir)) throw new PlainError('That folder does not exist.');
  return dir;
}

// Whether a file looks like text: no zero bytes near the start.
function looksLikeText(buffer: Buffer): boolean {
  const end = Math.min(buffer.length, 8192);
  for (let i = 0; i < end; i++) if (buffer[i] === 0) return false;
  return true;
}

export async function runSearchFiles(input: z.output<typeof searchFilesSchema>): Promise<string> {
  const dir = folderFor(input.path);
  let regex: RegExp;
  try {
    regex = new RegExp(input.pattern, input.ignoreCase ? 'i' : '');
  } catch {
    // Not a valid pattern: search for the words exactly as typed.
    regex = new RegExp(input.pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), input.ignoreCase ? 'i' : '');
  }
  const files = (
    await fg(input.include ? [input.include.includes('/') ? input.include : `**/${input.include}`] : ['**/*'], {
      cwd: dir,
      onlyFiles: true,
      dot: false,
      ignore: ignorePatterns(dir),
      suppressErrors: true,
    })
  ).sort();
  const found: { file: string; line: number; text: string }[] = [];
  let scanned = 0;
  let more = false;
  for (const file of files) {
    if (scanned >= MAX_FILES) break;
    scanned++;
    const full = path.join(dir, file);
    try {
      const info = await stat(full);
      if (info.size > MAX_FILE_BYTES) continue;
      const content = await readFile(full);
      if (!looksLikeText(content)) continue;
      const lines = content.toString('utf8').split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!regex.test(lines[i])) continue;
        if (found.length >= MAX_MATCHES) {
          more = true;
          break;
        }
        const text = lines[i].trim();
        found.push({ file, line: i + 1, text: text.length > MAX_LINE_CHARS ? `${text.slice(0, MAX_LINE_CHARS - 1)}…` : text });
      }
    } catch {
      // A file that cannot be read is skipped.
    }
    if (more) break;
  }
  if (found.length === 0) return `Nothing found for "${input.pattern}" in ${files.length} file${files.length === 1 ? '' : 's'}.`;
  const grouped = new Map<string, string[]>();
  for (const match of found) grouped.set(match.file, [...(grouped.get(match.file) ?? []), `  line ${match.line}: ${match.text}`]);
  const out = [`Found ${found.length}${more ? '+' : ''} match${found.length === 1 ? '' : 'es'} in ${grouped.size} file${grouped.size === 1 ? '' : 's'}:`];
  for (const [file, lines] of grouped) out.push(path.join(dir, file), ...lines);
  if (more) out.push(`(only the first ${MAX_MATCHES} matches are shown - search more narrowly, or in a subfolder, to see the rest)`);
  return out.join('\n');
}

export async function runFindFiles(input: z.output<typeof findFilesSchema>): Promise<string> {
  const dir = folderFor(input.path);
  const pattern = input.pattern.includes('/') || input.pattern.includes('**') ? input.pattern : `**/${input.pattern}`;
  const files = await fg([pattern], { cwd: dir, onlyFiles: true, dot: false, ignore: ignorePatterns(dir), suppressErrors: true, stats: true });
  if (files.length === 0) return `No files named like "${input.pattern}" in that folder.`;
  // Newest first, as OpenCode's glob does - what was worked on lately is usually what is wanted.
  const sorted = files.sort((a, b) => (b.stats?.mtimeMs ?? 0) - (a.stats?.mtimeMs ?? 0));
  const shown = sorted.slice(0, MAX_MATCHES).map((entry) => path.join(dir, entry.path));
  return sorted.length > MAX_MATCHES
    ? `${shown.join('\n')}\n(${sorted.length} files match - only the ${MAX_MATCHES} newest are shown; name them more narrowly to see others)`
    : shown.join('\n');
}
