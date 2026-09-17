import path from 'node:path';
import { session } from '../state/session.js';
import { settingsFolder } from '../platform/config.js';
import { CheckpointStore } from './store.js';

// Ties backups to the conversation: one checkpoint per message, taken just before
// the first thing Jeeves changes in answer to it (after permission, before the change),
// so /undo puts the folder back to how it was before that message.

let turnLabel = '';
let takenThisTurn = false;
const warnedIncomplete = new Set<string>();

export function checkpointStoreRoot(): string {
  return process.env.JEEVES_CHECKPOINTS_DIR || path.join(settingsFolder(), 'checkpoints');
}

function store(): CheckpointStore {
  return new CheckpointStore(checkpointStoreRoot(), process.cwd());
}

export function startTurnCheckpoints(label: string): void {
  turnLabel = label;
  takenThisTurn = false;
}

// Called before any change. Never throws: a backup failure is reported plainly and
// the person decides - but the change is not silently made without a backup.
export async function ensureCheckpoint(): Promise<{ ok: boolean; problem?: string }> {
  if (takenThisTurn) return { ok: true };
  session.setBusyNote('backing up…');
  try {
    const checkpoint = await store().create(turnLabel || 'a change');
    takenThisTurn = true;
    const folder = process.cwd();
    if (checkpoint.skipped.length > 0 && !warnedIncomplete.has(folder)) {
      warnedIncomplete.add(folder);
      const shown = checkpoint.skipped.slice(0, 3).join('; ');
      const more = checkpoint.skipped.length > 3 ? `, and ${checkpoint.skipped.length - 3} more` : '';
      session.addNotice(`Backup note: ${shown}${more}. /undo can't bring those back.`);
    }
    return { ok: true };
  } catch (error) {
    return { ok: false, problem: error instanceof Error ? error.message : String(error) };
  } finally {
    session.setBusyNote(null);
  }
}

export interface UndoOutcome {
  message: string;
  // A note for the model, so it knows the files changed back.
  historyNote: string | null;
}

export async function undoLastChange(): Promise<UndoOutcome> {
  const s = store();
  const checkpoint = await s.latestUndoable();
  if (!checkpoint) return { message: "There's nothing to undo in this project folder yet.", historyNote: null };
  session.setBusyNote('undoing…');
  try {
    const result = await s.restore(checkpoint);
    const parts: string[] = [];
    if (result.restored.length > 0) parts.push(`put back ${plural(result.restored.length, 'file')} (${listNames(result.restored)})`);
    if (result.removed.length > 0) parts.push(`removed ${plural(result.removed.length, 'file')} added since (${listNames(result.removed)})`);
    const what = parts.length > 0 ? parts.join(', and ') : 'nothing needed changing';
    const label = checkpoint.label.length > 60 ? checkpoint.label.slice(0, 59) + '…' : checkpoint.label;
    let message = `Undone: the folder is back to how it was before "${label}" - ${what}.`;
    if (result.failed.length > 0) message += ` ${plural(result.failed.length, 'file')} could not be put back: ${listNames(result.failed)}.`;
    if (checkpoint.skipped.length > 0) message += ' Some things were never backed up, so they were left as they are.';
    return {
      message,
      historyNote: `[The person used /undo. The project folder was put back to how it was before their message "${checkpoint.label}". Any changes made after that are gone - check files again before relying on earlier results.]`,
    };
  } finally {
    session.setBusyNote(null);
  }
}

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function listNames(files: string[]): string {
  const shown = files.slice(0, 3).join(', ');
  return files.length > 3 ? `${shown} and ${files.length - 3} more` : shown;
}

// Is this location outside the project folder (so /undo cannot reverse a change to it)?
export function isOutsideProject(target: string, folder = process.cwd()): boolean {
  const relative = path.relative(path.resolve(folder), path.resolve(folder, target));
  return relative.startsWith('..') || path.isAbsolute(relative);
}

// Could this command change things outside the project folder? A careful, simple
// check: absolute paths elsewhere, the home folder, parent folders, administrator
// rights, and installing programs for the whole computer.
export function commandMayReachOutside(command: string, folder = process.cwd()): boolean {
  if (/(^|[\s;|&])sudo\b|\bbrew\s|\s(-g|--global)\b|\bapt(-get)?\s|\bchoco\s|\bwinget\s/.test(command)) return true;
  if (/(^|[\s'"=])~(\/|\s|$)|(^|[\s'"=/])\.\.(\/|\\|\s|$)|\$HOME|%USERPROFILE%/.test(command)) return true;
  for (const match of command.matchAll(/(?:^|[\s'"=])((?:\/|[A-Za-z]:\\)[^\s'"]*)/g)) {
    const candidate = match[1];
    if (/^\/dev\/null$/.test(candidate)) continue;
    if (isOutsideProject(candidate, folder)) return true;
  }
  return false;
}
