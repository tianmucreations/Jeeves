import { stat, readFile } from 'node:fs/promises';

// Claude Code's read-before-write discipline (FileWriteTool validateInput +
// the mtime re-check inside the write), built once at the root: the conversation
// remembers exactly which files it has seen and how they looked, the write tool
// refuses to touch a file nobody has read, and the permission question shows the
// actual before/after lines so the person approves with open eyes.

interface FileSnapshot {
  mtimeMs: number;
  size: number;
}

// Files this conversation has seen (read or written), by resolved path.
const seen = new Map<string, FileSnapshot>();

async function snapshot(resolved: string): Promise<FileSnapshot | null> {
  try {
    const info = await stat(resolved);
    return { mtimeMs: info.mtimeMs, size: info.size };
  } catch {
    return null;
  }
}

// Called after a successful read or write, so the record matches the disk.
export async function noteFileSeen(resolved: string): Promise<void> {
  const snap = await snapshot(resolved);
  if (snap) seen.set(resolved, snap);
}

// /clear starts a fresh conversation, so the memory starts fresh too.
export function resetSeenFiles(): void {
  seen.clear();
}

// True when the file is on disk exactly as this conversation last saw it.
export async function fileUnchanged(resolved: string): Promise<boolean> {
  const current = await snapshot(resolved);
  if (!current) return false;
  const before = seen.get(resolved);
  return before !== undefined && before.mtimeMs === current.mtimeMs && before.size === current.size;
}

// A reason the write is refused before anything is asked or changed, or null.
// The words go to the model as its instruction and to the screen as the record.
export async function writeRefusal(resolved: string): Promise<string | null> {
  const current = await snapshot(resolved);
  // A brand-new file overwrites nothing, so it needs no read first.
  if (!current) return null;
  const before = seen.get(resolved);
  if (!before) return "hasn't been read yet - read it first, then write it";
  if (before.mtimeMs !== current.mtimeMs || before.size !== current.size) {
    return 'changed since it was last read - read it again first, then write it';
  }
  return null;
}

// The changed lines for the permission question, or null when there is nothing
// to show (a write of identical content). Capped, so a big rewrite stays one
// short preview: the common start and end of the two texts are stripped and the
// changed middle is shown, removals first.
export async function writePreview(resolved: string, content: string): Promise<string | null> {
  let before: string | null = null;
  try {
    before = await readFile(resolved, 'utf8');
  } catch {
    before = null;
  }
  const newLines = content.split('\n');
  if (before === null) {
    const lines = newLines.slice(0, 3).map((line) => '+ ' + line);
    lines.push(`… a new file, ${newLines.length} ${newLines.length === 1 ? 'line' : 'lines'}`);
    return lines.join('\n');
  }
  const oldLines = before.split('\n');
  let start = 0;
  while (start < oldLines.length && start < newLines.length && oldLines[start] === newLines[start]) start++;
  let endOld = oldLines.length;
  let endNew = newLines.length;
  while (endOld > start && endNew > start && oldLines[endOld - 1] === newLines[endNew - 1]) {
    endOld--;
    endNew--;
  }
  const removed = oldLines.slice(start, endOld);
  const added = newLines.slice(start, endNew);
  if (removed.length === 0 && added.length === 0) return null;
  const lines = [
    ...removed.slice(0, 3).map((line) => '- ' + line),
    ...added.slice(0, 3).map((line) => '+ ' + line),
  ];
  const hidden = removed.length + added.length - lines.length;
  if (hidden > 0) lines.push(`… ${hidden} more changed ${hidden === 1 ? 'line' : 'lines'}`);
  return lines.join('\n');
}
