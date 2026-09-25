import path from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';

// Path helpers. Resolving against the current folder keeps behaviour identical on macOS, Windows, and Linux.

// THE one helper every file path goes through before any tool uses it. This is
// Claude Code's expandPath (src/utils/path.ts) - its file tools run every input
// through it ("expand so hook allowlists can't be bypassed via ~ or relative
// paths"), and OpenCode's file tools follow the same absolute-or-join-to-
// working-directory pattern (packages/opencode/src/tool/write.ts). Both demand
// absolute paths in their tool schemas AND expand whatever arrives anyway.
// 25 Sept: path.resolve alone treated ~ as a folder NAME under the project, so
// ~/Documents/Projects was told "That folder does not exist." and the
// outside-project check judged a home-folder write as inside the project.
// Semantics (Claude Code's, verbatim):
//   ~          -> the home folder
//   ~/x        -> x inside the home folder
//   absolute   -> normalised
//   relative   -> resolved against baseDir (the working directory)
//   whitespace -> trimmed; empty -> the base directory; null bytes -> refused
// A bare ~name (another user's folder) is left alone.
export function expandPath(p: string, baseDir: string = process.cwd()): string {
  if (p.includes('\0')) throw new Error('Path contains null bytes');
  const trimmed = p.trim();
  if (!trimmed) return path.normalize(baseDir);
  if (trimmed === '~') return homedir();
  if (trimmed.startsWith('~/') || trimmed.startsWith('~\\')) return path.join(homedir(), trimmed.slice(2));
  if (path.isAbsolute(trimmed)) return path.normalize(trimmed);
  return path.resolve(baseDir, trimmed);
}

export function resolveFromCwd(p: string): string {
  return expandPath(p);
}

export interface FolderEntry {
  name: string;
  path: string;
}

// The standard user locations the folder browser offers first; only existing ones are shown.
export function homeLocations(): FolderEntry[] {
  const home = homedir();
  const candidates: { label: string; folder: string }[] = [
    { label: 'Desktop', folder: 'Desktop' },
    { label: 'Documents', folder: 'Documents' },
    { label: 'Downloads', folder: 'Downloads' },
    { label: 'Home', folder: '' },
    { label: 'Pictures', folder: 'Pictures' },
    { label: 'Music', folder: 'Music' },
    { label: 'Movies', folder: 'Movies' },
  ];
  return candidates
    .filter((candidate) => candidate.folder === '' || existsSync(path.join(home, candidate.folder)))
    .map((candidate) => ({ name: candidate.label, path: candidate.folder === '' ? home : path.join(home, candidate.folder) }));
}

// Lists the subfolders of a directory, hiding dot-folders; failures are reported, never thrown.
export function listSubfolders(dir: string): { folders: FolderEntry[]; error: string } {
  try {
    const entries = readdirSync(dir, { withFileTypes: true });
    const folders = entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => ({ name: entry.name, path: path.join(dir, entry.name) }))
      .sort((a, b) => a.name.toLowerCase().localeCompare(b.name.toLowerCase()));
    return { folders, error: '' };
  } catch {
    return { folders: [], error: 'This folder could not be opened.' };
  }
}

// Short display form for paths: the home folder becomes ~.
export function displayPath(p: string): string {
  const home = homedir();
  if (p === home) return '~';
  if (p.startsWith(home + path.sep)) {
    return '~' + p.slice(home.length);
  }
  return p;
}

// Returns a plain-English problem with a proposed project name, or null when the name is fine.
export function projectNameProblem(name: string): string | null {
  const trimmed = name.trim();
  if (!trimmed) return 'Give the project a name first.';
  if (/[/\\:*?"<>|]/.test(trimmed)) {
    return 'Names cannot contain / \\ : * ? " < > or | - try another name.';
  }
  if (trimmed === '.' || trimmed === '..') {
    return 'That is not a valid name - try another.';
  }
  return null;
}