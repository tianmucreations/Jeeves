import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { settingsFolder } from './config.js';

// What Jeeves remembers between conversations, as Claude Code's auto memory (src/memdir: small notes
// kept in files and read into every session) and OpenCode's AGENTS.md (notes read into the rulebook)
// do - but kept where the person can see and remove each note in Settings, "What I remember".
// Two places: about the person (everywhere), and about one folder. Short notes only, capped.
export interface Note {
  id: string;
  text: string;
  added: number;
}

interface Store {
  me: Note[];
  folders: Record<string, Note[]>;
}

export const MAX_NOTES = 40;
export const MAX_NOTE_CHARS = 300;

const fileOf = () => path.join(settingsFolder(), 'memory.json');

function load(): Store {
  try {
    const raw = JSON.parse(readFileSync(fileOf(), 'utf8')) as Partial<Store>;
    return { me: Array.isArray(raw.me) ? raw.me : [], folders: raw.folders && typeof raw.folders === 'object' ? raw.folders : {} };
  } catch {
    return { me: [], folders: {} };
  }
}

function save(store: Store): void {
  try {
    mkdirSync(settingsFolder(), { recursive: true });
    const temp = `${fileOf()}.tmp`;
    writeFileSync(temp, JSON.stringify(store, null, 1));
    renameSync(temp, fileOf());
  } catch {
    // Not saved this time; nothing else depends on it.
  }
}

export type Scope = 'me' | 'folder';

const clean = (text: string) => text.replace(/\s+/g, ' ').trim().slice(0, MAX_NOTE_CHARS);

// Adds a note; false when it is empty, already there, or the place is full.
export function addNote(scope: Scope, text: string, folder = process.cwd()): 'added' | 'duplicate' | 'full' | 'empty' {
  const note = clean(text);
  if (!note) return 'empty';
  const store = load();
  const list = scope === 'me' ? store.me : (store.folders[folder] ??= []);
  if (list.some((existing) => existing.text.toLowerCase() === note.toLowerCase())) return 'duplicate';
  if (list.length >= MAX_NOTES) return 'full';
  list.push({ id: randomUUID().slice(0, 8), text: note, added: Date.now() });
  save(store);
  return 'added';
}

// Removes the note with this id, or (for "forget that ...") the one whose words match best.
export function removeNote(idOrWords: string, folder = process.cwd()): Note | null {
  const store = load();
  const lists = [store.me, store.folders[folder] ?? []];
  const words = idOrWords.toLowerCase().split(/\s+/).filter((word) => word.length > 2);
  for (const list of lists) {
    let index = list.findIndex((note) => note.id === idOrWords);
    if (index < 0 && words.length > 0) {
      const scored = list.map((note, i) => ({ i, hits: words.filter((word) => note.text.toLowerCase().includes(word)).length })).sort((a, b) => b.hits - a.hits)[0];
      if (scored && scored.hits >= Math.max(1, Math.ceil(words.length / 2))) index = scored.i;
    }
    if (index >= 0) {
      const [gone] = list.splice(index, 1);
      save(store);
      return gone;
    }
  }
  return null;
}

export function notesAboutMe(): Note[] {
  return load().me;
}

export function notesAboutFolder(folder = process.cwd()): Note[] {
  return load().folders[folder] ?? [];
}

// Everything, for Settings: each note with where it belongs.
export function allNotes(folder = process.cwd()): { id: string; text: string; about: 'me' | 'this folder' }[] {
  return [...notesAboutMe().map((n) => ({ ...n, about: 'me' as const })), ...notesAboutFolder(folder).map((n) => ({ ...n, about: 'this folder' as const }))];
}

// The part of the rulebook that carries the notes (empty when there are none).
export function memoryBlock(folder = process.cwd()): string {
  const me = notesAboutMe();
  const here = notesAboutFolder(folder);
  if (me.length === 0 && here.length === 0) return '';
  const lines = ['', '', 'What You Remember', 'Notes kept from earlier conversations. Use them naturally; do not recite them unless asked.'];
  if (me.length > 0) lines.push('About the person:', ...me.map((n) => `- ${n.text}`));
  if (here.length > 0) lines.push('About this folder:', ...here.map((n) => `- ${n.text}`));
  return lines.join('\n');
}
