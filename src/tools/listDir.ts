import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { z } from 'zod';
import { resolveFromCwd } from '../platform/paths.js';
import { PlainError } from './plain.js';

export const listDirSchema = z.object({
  path: z.string().describe("The absolute path to the directory to list. A leading ~ means the home folder; a relative path is resolved against the working directory."),
  recursive: z.boolean().optional().describe('Include all subfolders'),
});

// Assumption: only the top-level .gitignore of the listed folder is honoured, and negation
// rules (!) are not supported - typical project files use plain ignore rules only.
// Glob patterns use forward slashes on every platform by design (fast-glob normalises them),
// so these are not filesystem paths and never need path.sep.
function ignorePatterns(dir: string): string[] {
  const patterns = ['**/.git', '**/.git/**', '**/node_modules', '**/node_modules/**'];
  const gitignorePath = path.join(dir, '.gitignore');
  if (!existsSync(gitignorePath)) return patterns;
  const lines = readFileSync(gitignorePath, 'utf8').split('\n');
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith('!')) continue;
    const anchored = line.startsWith('/');
    const cleaned = line.replace(/^\//, '').replace(/\/+$/, '');
    if (!cleaned) continue;
    if (anchored) {
      patterns.push(cleaned, `${cleaned}/**`);
    } else {
      patterns.push(`**/${cleaned}`, `**/${cleaned}/**`);
    }
  }
  return patterns;
}

export async function runListDir(input: z.output<typeof listDirSchema>): Promise<string> {
  const dir = resolveFromCwd(input.path);
  if (!existsSync(dir)) {
    throw new PlainError('That folder does not exist.');
  }
  const entries = await fg(input.recursive ? ['**/*'] : ['*'], {
    cwd: dir,
    onlyFiles: false,
    dot: false,
    deep: input.recursive ? 8 : 1,
    ignore: ignorePatterns(dir),
  });
  if (entries.length === 0) return '(empty folder)';
  const sorted = entries.sort();
  const cap = 2000;
  const shown = sorted.slice(0, cap).join('\n');
  return sorted.length > cap ? `${shown}\n(and ${sorted.length - cap} more)` : shown;
}