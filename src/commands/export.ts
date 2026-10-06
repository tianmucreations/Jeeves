import { writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { session, type TranscriptEntry } from '../state/session.js';
import { copyToClipboard } from '../ink/clipboard.js';
import { displayPath } from '../platform/paths.js';

// Getting something out of Jeeves: copy the last answer, or save the whole conversation as a document.
// Claude Code has /copy (its last reply; "/copy N" for an earlier one) and /export (a plain .txt named
// from the first message and the time, to a file or the clipboard); OpenCode has copy and export of the
// session. Same two things, as buttons.
// Answers are written with light formatting marks (**bold**, # headings, `code`); pasted into an email or
// a document they would show as stray asterisks, so copies and saved files carry plain text.
export function plainText(markdown: string): string {
  return markdown
    .replace(/```[^\n]*\n?/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '$1 ($2)')
    .replace(/\*\*([^*\n]+)\*\*/g, '$1')
    .replace(/__([^_\n]+)__/g, '$1')
    .replace(/(^|[\s(])\*([^*\n]+)\*(?=[\s).,;:!?]|$)/g, '$1$2')
    .replace(/`([^`\n]+)`/g, '$1');
}

export function lastAnswer(entries: TranscriptEntry[] = session.transcript): string | null {
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry.kind === 'assistant' && entry.text.trim()) return plainText(entry.text.trim());
  }
  return null;
}

function stamp(date: Date): { readable: string; file: string } {
  const pad = (n: number) => String(n).padStart(2, '0');
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return {
    readable: `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}, ${pad(date.getHours())}:${pad(date.getMinutes())}`,
    file: `${day} ${pad(date.getHours())}${pad(date.getMinutes())}`,
  };
}

// The conversation as plain readable text: what the person said and what Jeeves answered.
export function conversationText(entries: TranscriptEntry[] = session.transcript, folder = process.cwd(), now = new Date()): string {
  const lines = ['Conversation with Jeeves', `Saved ${stamp(now).readable}`, `Folder: ${displayPath(folder)}`, ''];
  for (const entry of entries) {
    if (entry.kind === 'user') lines.push(`You: ${entry.text.trim()}`, '');
    else if (entry.kind === 'assistant' && entry.text.trim()) lines.push(`Jeeves: ${plainText(entry.text.trim())}`, '');
  }
  return lines.join('\n').trimEnd() + '\n';
}

// A file name from the first message: letters, numbers and spaces only, short.
export function conversationFileName(entries: TranscriptEntry[] = session.transcript, now = new Date()): string {
  const first = entries.find((entry) => entry.kind === 'user');
  const words = first && first.kind === 'user' ? first.text.replace(/[^\p{L}\p{N} ]+/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40).trim() : '';
  return `Conversation${words ? ` - ${words}` : ''} - ${stamp(now).file}.txt`;
}

export async function copyLastAnswer(): Promise<void> {
  const text = lastAnswer();
  if (!text) {
    session.addNotice("There's no answer to copy yet.");
    return;
  }
  const copied = await copyToClipboard(text);
  session.showToast(copied ? 'Copied to clipboard' : "Couldn't copy that", copied ? 'info' : 'error');
}

// Writes the conversation into the folder Jeeves is working in (never over an existing file).
export function saveConversationFile(folder = process.cwd(), now = new Date()): string | null {
  if (!session.transcript.some((entry) => entry.kind === 'user')) return null;
  const base = conversationFileName(session.transcript, now);
  let target = path.join(folder, base);
  for (let n = 2; existsSync(target); n++) target = path.join(folder, base.replace(/\.txt$/, ` (${n}).txt`));
  writeFileSync(target, conversationText(session.transcript, folder, now), 'utf8');
  return target;
}
