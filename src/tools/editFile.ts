import { readFile, writeFile as fsWriteFile } from 'node:fs/promises';
import { z } from 'zod';
import { resolveFromCwd } from '../platform/paths.js';
import { noteFileSeen, writeRefusal } from './write-safety.js';

// Changing one part of a file, as Claude Code's Edit tool and OpenCode's edit tool do:
// find an exact piece of text and swap it for another, instead of writing the whole
// file again. Quicker, cheaper, and a big file's other parts can't be damaged.
// Their rules, kept: the file must have been read first and unchanged since; the old
// text must be found, and be the only match unless every match is meant.
export const editFileSchema = z.object({
  path: z.string().describe('The absolute path to the file to change. A leading ~ means the home folder; a relative path is resolved against the working directory.'),
  oldText: z.string().describe('The exact text to replace, character for character (indentation included), with enough around it to be the only match'),
  newText: z.string().describe('The text to put in its place'),
  replaceAll: z.boolean().optional().describe('true: replace every match (for renaming something everywhere in the file)'),
});

type EditInput = z.output<typeof editFileSchema>;

function countMatches(text: string, find: string): number {
  let count = 0;
  for (let at = text.indexOf(find); at !== -1; at = text.indexOf(find, at + find.length)) count++;
  return count;
}

// The file as it would be after the change, or the plain reason it cannot be made.
function applyEdit(before: string, input: EditInput): { ok: true; content: string } | { ok: false; reason: string } {
  if (input.oldText === input.newText) return { ok: false, reason: 'the old and new text are the same - nothing to change' };
  if (input.oldText === '') return { ok: false, reason: 'the text to replace is empty - use writeFile to make a new file' };
  const matches = countMatches(before, input.oldText);
  if (matches === 0) return { ok: false, reason: "that text isn't in the file - read the file again and copy the exact words" };
  if (matches > 1 && !input.replaceAll) {
    return { ok: false, reason: `that text appears ${matches} times - add more of the words around it so it matches once, or set replaceAll to change every one` };
  }
  // A split/join replaces literally: no character in the new text is treated specially.
  return { ok: true, content: before.split(input.oldText).join(input.newText) };
}

// Why the edit cannot happen yet (before anything is asked or changed), or null.
export async function editRefusal(input: EditInput): Promise<string | null> {
  const resolved = resolveFromCwd(input.path);
  let before: string;
  try {
    before = await readFile(resolved, 'utf8');
  } catch {
    return "couldn't find that file - to make a new one, use writeFile";
  }
  const unread = await writeRefusal(resolved);
  if (unread) return unread.replace('then write it', 'then edit it');
  const result = applyEdit(before, input);
  return result.ok ? null : result.reason;
}

export async function editedContent(input: EditInput): Promise<{ before: string; after: string } | null> {
  try {
    const before = await readFile(resolveFromCwd(input.path), 'utf8');
    const result = applyEdit(before, input);
    return result.ok ? { before, after: result.content } : null;
  } catch {
    return null;
  }
}

export async function runEditFile(input: EditInput): Promise<string> {
  const resolved = resolveFromCwd(input.path);
  const before = await readFile(resolved, 'utf8');
  const result = applyEdit(before, input);
  if (!result.ok) throw new Error(result.reason);
  await fsWriteFile(resolved, result.content, 'utf8');
  // The conversation knows what is in the file now, so a further edit needs no fresh read.
  await noteFileSeen(resolved);
  const count = countMatches(before, input.oldText);
  return `Changed ${count === 1 ? '1 place' : `${count} places`} in ${input.path}.`;
}
