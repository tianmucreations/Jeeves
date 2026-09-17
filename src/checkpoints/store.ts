import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

// Automatic backups ("checkpoints") of the project folder, so /undo can put things
// back. Researched first: Claude Code keeps copies of files its own edit tools
// change, but cannot undo what a shell command did; Cline and Gemini CLI snapshot
// the whole folder into a hidden git repository, which covers commands but needs git
// installed - not a given on a non-coder's machine. This takes the whole-folder
// approach without git: every file is stored once by its content fingerprint
// (SHA-256), and a checkpoint is a list of which fingerprint each file had. Files
// that have not changed since the last checkpoint are recognised by size and
// modified time and are not read again.

// Folders that are rebuilt automatically or are the person's own version history.
// Restoring a .git folder from a copy could damage that history, so it is left alone.
export const SKIPPED_FOLDERS = new Set(['.git', 'node_modules', '.venv', 'venv', '__pycache__', '.DS_Store']);
// Limits that keep a checkpoint fast. Past them the checkpoint is marked incomplete
// and the person is told plainly that some things could not be backed up.
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_FILES = 20_000;
export const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;
export const KEEP_CHECKPOINTS = 50;

export interface FileRecord {
  hash: string;
  size: number;
  mtimeMs: number;
  mode: number;
}

export interface Checkpoint {
  id: string;
  // 'turn': taken before Jeeves changed something. 'before-undo': a safety copy taken
  // just before an undo, kept so an undo can itself be recovered, but never undone to.
  kind: 'turn' | 'before-undo';
  createdAt: number;
  label: string;
  folder: string;
  files: Record<string, FileRecord>;
  folders: string[];
  // Anything that could not be backed up, in plain words (empty when complete).
  skipped: string[];
}

export interface UndoResult {
  checkpoint: Checkpoint;
  restored: string[];
  removed: string[];
  // Files that could not be put back (for example, permission problems).
  failed: string[];
}

export function projectKey(folder: string): string {
  return createHash('sha256').update(path.resolve(folder)).digest('hex').slice(0, 16);
}

export class CheckpointStore {
  readonly dir: string;

  constructor(storeRoot: string, readonly folder: string) {
    this.dir = path.join(storeRoot, projectKey(folder));
  }

  private blobPath(hash: string): string {
    return path.join(this.dir, 'blobs', hash.slice(0, 2), hash);
  }

  private checkpointsDir(): string {
    return path.join(this.dir, 'checkpoints');
  }

  async list(): Promise<Checkpoint[]> {
    let names: string[];
    try {
      names = await fs.readdir(this.checkpointsDir());
    } catch {
      return [];
    }
    const checkpoints: Checkpoint[] = [];
    for (const name of names.filter((n) => n.endsWith('.json')).sort()) {
      try {
        checkpoints.push(JSON.parse(await fs.readFile(path.join(this.checkpointsDir(), name), 'utf8')) as Checkpoint);
      } catch {
        // A damaged checkpoint record is ignored rather than breaking undo entirely.
      }
    }
    return checkpoints.sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
  }

  // Walks the folder and records every file, storing any content not stored before.
  async create(label: string, now = Date.now(), kind: Checkpoint['kind'] = 'turn'): Promise<Checkpoint> {
    const previous = (await this.list()).at(-1);
    const files: Record<string, FileRecord> = {};
    const folders: string[] = [];
    const skipped: string[] = [];
    let count = 0;
    let total = 0;
    let overLimit = false;

    const walk = async (relative: string): Promise<void> => {
      let entries;
      try {
        entries = await fs.readdir(path.join(this.folder, relative), { withFileTypes: true });
      } catch {
        skipped.push(`the folder "${relative || '.'}" could not be read`);
        return;
      }
      for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        const rel = relative ? path.join(relative, entry.name) : entry.name;
        if (SKIPPED_FOLDERS.has(entry.name)) continue;
        if (entry.isSymbolicLink()) {
          skipped.push(`"${rel}" is a shortcut (link), which is not backed up`);
          continue;
        }
        if (entry.isDirectory()) {
          folders.push(rel);
          await walk(rel);
          continue;
        }
        if (!entry.isFile()) continue;
        const full = path.join(this.folder, rel);
        let stat;
        try {
          stat = await fs.stat(full);
        } catch {
          skipped.push(`"${rel}" could not be read`);
          continue;
        }
        if (stat.size > MAX_FILE_BYTES) {
          skipped.push(`"${rel}" is too large to back up`);
          continue;
        }
        if (count >= MAX_FILES || total + stat.size > MAX_TOTAL_BYTES) {
          overLimit = true;
          continue;
        }
        const known = previous?.files[rel];
        if (known && known.size === stat.size && known.mtimeMs === stat.mtimeMs && (await this.hasBlob(known.hash))) {
          files[rel] = { ...known, mode: stat.mode };
        } else {
          try {
            const content = await fs.readFile(full);
            const hash = createHash('sha256').update(content).digest('hex');
            await this.storeBlob(hash, content);
            files[rel] = { hash, size: stat.size, mtimeMs: stat.mtimeMs, mode: stat.mode };
          } catch {
            skipped.push(`"${rel}" could not be read`);
            continue;
          }
        }
        count += 1;
        total += stat.size;
      }
    };
    await walk('');
    if (overLimit) skipped.push('the folder is too big to back up completely');

    const checkpoint: Checkpoint = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      kind,
      createdAt: now,
      label: label.slice(0, 200),
      folder: path.resolve(this.folder),
      files,
      folders,
      skipped,
    };
    await fs.mkdir(this.checkpointsDir(), { recursive: true });
    await fs.writeFile(path.join(this.checkpointsDir(), `${checkpoint.id}.json`), JSON.stringify(checkpoint));
    await this.prune();
    return checkpoint;
  }

  private async hasBlob(hash: string): Promise<boolean> {
    try {
      await fs.access(this.blobPath(hash));
      return true;
    } catch {
      return false;
    }
  }

  private async storeBlob(hash: string, content: Buffer): Promise<void> {
    const target = this.blobPath(hash);
    if (await this.hasBlob(hash)) return;
    await fs.mkdir(path.dirname(target), { recursive: true });
    // Written beside the target, then renamed, so a crash never leaves half a copy.
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, content);
    await fs.rename(temporary, target);
  }

  // Puts the folder back exactly as it was at the checkpoint: changed and deleted
  // files come back, and files created since are removed. A checkpoint of the
  // current state is taken first, so nothing is ever lost by undoing.
  async restore(checkpoint: Checkpoint, now = Date.now()): Promise<UndoResult> {
    const current = await this.create(`before undoing "${checkpoint.label}"`, now, 'before-undo');
    const restored: string[] = [];
    const removed: string[] = [];
    const failed: string[] = [];

    for (const [rel, record] of Object.entries(checkpoint.files)) {
      if (current.files[rel]?.hash === record.hash) continue;
      const full = path.join(this.folder, rel);
      try {
        const content = await fs.readFile(this.blobPath(record.hash));
        await fs.mkdir(path.dirname(full), { recursive: true });
        await fs.writeFile(full, content);
        await fs.chmod(full, record.mode & 0o777);
        restored.push(rel);
      } catch {
        failed.push(rel);
      }
    }
    // Files created since are removed - but only when both copies are complete. If
    // anything was skipped, a file missing from the checkpoint might simply not have
    // been backed up, so nothing is deleted blind.
    const incomplete = checkpoint.skipped.length > 0 || current.skipped.length > 0;
    for (const rel of Object.keys(current.files)) {
      if (rel in checkpoint.files || incomplete) continue;
      try {
        await fs.rm(path.join(this.folder, rel));
        removed.push(rel);
      } catch {
        failed.push(rel);
      }
    }
    // Folders created since the checkpoint are removed if they are now empty.
    for (const rel of [...current.folders].sort((a, b) => b.length - a.length)) {
      if (checkpoint.folders.includes(rel) || incomplete) continue;
      try {
        await fs.rmdir(path.join(this.folder, rel));
      } catch {
        // Not empty (or already gone) - left as it is.
      }
    }
    // The undone checkpoint is used up, so the next /undo goes one step further back.
    await fs.rm(path.join(this.checkpointsDir(), `${checkpoint.id}.json`), { force: true });
    return { checkpoint, restored: restored.sort(), removed: removed.sort(), failed: failed.sort() };
  }

  // The most recent checkpoint that /undo would go back to.
  async latestUndoable(): Promise<Checkpoint | undefined> {
    return (await this.list()).filter((checkpoint) => checkpoint.kind !== 'before-undo').at(-1);
  }

  // Keeps the most recent checkpoints and deletes stored content nothing refers to.
  private async prune(): Promise<void> {
    const all = await this.list();
    const excess = all.slice(0, Math.max(0, all.length - KEEP_CHECKPOINTS));
    if (excess.length === 0) return;
    for (const checkpoint of excess) {
      await fs.rm(path.join(this.checkpointsDir(), `${checkpoint.id}.json`), { force: true });
    }
    const referenced = new Set(all.slice(excess.length).flatMap((checkpoint) => Object.values(checkpoint.files).map((f) => f.hash)));
    const blobsRoot = path.join(this.dir, 'blobs');
    for (const prefix of await fs.readdir(blobsRoot).catch(() => [] as string[])) {
      for (const hash of await fs.readdir(path.join(blobsRoot, prefix)).catch(() => [] as string[])) {
        if (!referenced.has(hash)) await fs.rm(path.join(blobsRoot, prefix, hash), { force: true });
      }
    }
  }
}
