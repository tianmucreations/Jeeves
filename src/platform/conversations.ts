import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { session, type TranscriptEntry } from '../state/session.js';
import { settingsFolder } from './config.js';

// Saved conversations, as Claude Code and OpenCode keep them: every conversation is
// written to its own file as it goes (Claude Code: one .jsonl per session under
// ~/.claude/projects/<folder>/; OpenCode: a session list in its database), listed by
// its first message and how long ago, and picked up again where it stopped.
// Like Claude Code, the list shows the conversations of the folder you are in.
// Nothing is ever limited or deleted on its own.

export interface SavedConversation {
  id: string;
  folder: string;
  title: string;
  created: number;
  updated: number;
  transcript: TranscriptEntry[];
  history: unknown[];
  todos?: { content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }[];
}

export interface ConversationSummary {
  id: string;
  title: string;
  updated: number;
  messages: number;
}

let currentId: string | null = null;
let currentCreated = 0;

function folderOfConversations(): string {
  return path.join(settingsFolder(), 'conversations');
}

const fileOf = (id: string) => path.join(folderOfConversations(), `${id}.json`);

// A new, empty conversation: the next save starts a new file.
export function startNewConversation(): void {
  currentId = null;
}

function titleOf(transcript: TranscriptEntry[]): string {
  const first = transcript.find((entry) => entry.kind === 'user');
  const text = first && first.kind === 'user' ? first.text.replace(/\s+/g, ' ').trim() : '';
  return text.length > 70 ? text.slice(0, 69) + '…' : text || 'Untitled';
}

// Writes the conversation on screen. Quiet and safe: a failure never interrupts anyone.
export function saveConversation(): void {
  if (!session.transcript.some((entry) => entry.kind === 'user')) return;
  try {
    if (!currentId) {
      currentId = randomUUID();
      currentCreated = Date.now();
    }
    const record: SavedConversation = {
      id: currentId,
      folder: process.cwd(),
      title: titleOf(session.transcript),
      created: currentCreated,
      updated: Date.now(),
      transcript: session.transcript,
      history: session.history,
      todos: session.todos,
    };
    mkdirSync(folderOfConversations(), { recursive: true });
    // Written beside, then moved into place, so a crash mid-write never leaves half a file.
    const temp = `${fileOf(currentId)}.tmp`;
    writeFileSync(temp, JSON.stringify(record));
    renameSync(temp, fileOf(currentId));
  } catch {
    // Not saved this time; the next message tries again.
  }
}

// This folder's conversations, newest first.
export function listConversations(folder = process.cwd()): ConversationSummary[] {
  const out: ConversationSummary[] = [];
  let names: string[] = [];
  try {
    names = readdirSync(folderOfConversations()).filter((name) => name.endsWith('.json'));
  } catch {
    return out;
  }
  for (const name of names) {
    try {
      const record = JSON.parse(readFileSync(path.join(folderOfConversations(), name), 'utf8')) as SavedConversation;
      if (record.folder !== folder) continue;
      out.push({ id: record.id, title: record.title, updated: record.updated ?? statSync(path.join(folderOfConversations(), name)).mtimeMs, messages: record.transcript.filter((entry) => entry.kind === 'user').length });
    } catch {
      // A damaged file is skipped, never fatal.
    }
  }
  return out.sort((a, b) => b.updated - a.updated);
}

// Puts a saved conversation back on screen and back in the model's memory, so the next
// message carries on exactly where it stopped.
export function resumeConversation(id: string): boolean {
  try {
    const record = JSON.parse(readFileSync(fileOf(id), 'utf8')) as SavedConversation;
    session.restoreConversation(record.transcript, record.history as never);
    session.setTodos(record.todos ?? []);
    currentId = record.id;
    currentCreated = record.created;
    return true;
  } catch {
    return false;
  }
}

export function deleteConversation(id: string): void {
  try {
    rmSync(fileOf(id), { force: true });
    if (currentId === id) currentId = null;
  } catch {
    // Already gone.
  }
}

// "3 days ago" - the words the list uses.
export function ago(time: number, now = Date.now()): string {
  const minutes = Math.floor((now - time) / 60_000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;
  const months = Math.floor(days / 30);
  return `${months} month${months === 1 ? '' : 's'} ago`;
}
