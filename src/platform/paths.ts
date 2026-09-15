import path from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readdirSync } from 'node:fs';

// Path helpers. Resolving against the current folder keeps behaviour identical on macOS, Windows, and Linux.
export function resolveFromCwd(p: string): string {
  return path.resolve(p);
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