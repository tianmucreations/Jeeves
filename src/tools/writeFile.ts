import { mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveFromCwd } from '../platform/paths.js';
import { noteFileSeen } from './write-safety.js';

export const writeFileSchema = z.object({
  path: z.string().describe("The absolute path to the file to write. A leading ~ means the home folder; a relative path is resolved against the working directory."),
  content: z.string().describe('The complete text content for the file'),
});

export async function runWriteFile(input: z.output<typeof writeFileSchema>): Promise<string> {
  const resolved = resolveFromCwd(input.path);
  // Assumption: missing parent folders are created so new files can land in new folders.
  await mkdir(path.dirname(resolved), { recursive: true });
  await fsWriteFile(resolved, input.content, 'utf8');
  // The conversation now knows exactly what is in this file, so a further write
  // to it needs no fresh read (write-safety).
  await noteFileSeen(resolved);
  return `Wrote ${input.content.length} characters to ${input.path}.`;
}