import { readFile as fsReadFile } from 'node:fs/promises';
import { z } from 'zod';
import { resolveFromCwd } from '../platform/paths.js';
import { noteFileSeen, fileUnchanged } from './write-safety.js';

export const readFileSchema = z.object({
  path: z.string().describe("The absolute path to the file to read. A leading ~ means the home folder; a relative path is resolved against the working directory."),
  offset: z.number().int().min(1).optional().describe('The line to start from (1 is the first line). Read a big file in pieces: 2000 lines come back at a time, then continue with offset.'),
  limit: z.number().int().min(1).max(2000).optional().describe('How many lines to read this time (up to 2000).'),
});

// Claude Code's Read limits (FileReadTool/prompt.ts + limits.ts): 2,000 lines at
// a time with "use offset to continue" told to the model, and a hard ceiling per
// read (theirs 25,000 tokens - about 100,000 characters by the usual 4-chars-per-
// token estimate). Re-reading a file that has not changed returns a note instead
// of the same text twice - the conversation already holds it.
const DEFAULT_LINES = 2_000;
const MAX_CHARS = 100_000;

export async function runReadFile(input: z.output<typeof readFileSchema>): Promise<string> {
  const resolved = resolveFromCwd(input.path);
  const contents = await fsReadFile(resolved, 'utf8');
  // Guard against feeding binary files into the conversation as gibberish.
  if (contents.slice(0, 1000).includes('\u0000')) {
    throw new Error('This looks like a binary file; it cannot be read as text.');
  }
  // A plain re-read of an unchanged file: already in the conversation, so the
  // model is told so instead of paying for the text twice. A slice request
  // (offset past the first line, or an explicit limit) is served normally - that
  // is how the model pages through a big file it has only partly seen.
  const wantsSlice = (input.offset ?? 1) > 1 || input.limit !== undefined;
  if (!wantsSlice && (await fileUnchanged(resolved))) {
    return 'This file has not changed since you read it, so its contents are already in this conversation. If you need a specific part again, read it with offset for the line to start from.';
  }
  // The conversation now knows exactly what is in this file (write-safety).
  await noteFileSeen(resolved);
  const allLines = contents.split('\n');
  if (allLines.length === 1 && allLines[0] === '') return '(this file is empty)';
  const start = Math.min((input.offset ?? 1) - 1, allLines.length - 1);
  const slice = allLines.slice(start, start + (input.limit ?? DEFAULT_LINES));
  let text = slice.join('\n');
  const readTo = start + slice.length;
  const notes: string[] = [];
  if (start > 0) notes.push(`starting from line ${start + 1}`);
  if (text.length > MAX_CHARS) {
    text = text.slice(0, MAX_CHARS);
    notes.push('stopped at the size limit - read on with offset for the next line and a smaller limit');
  } else if (readTo < allLines.length) {
    notes.push(`this file has ${allLines.length} lines in total - continue with offset=${readTo + 1}`);
  }
  return notes.length > 0 ? `${text}\n[${notes.join('; ')}]` : text;
}
