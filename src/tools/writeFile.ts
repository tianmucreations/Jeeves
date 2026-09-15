import { mkdir, writeFile as fsWriteFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { resolveFromCwd } from '../platform/paths.js';

export const writeFileSchema = z.object({
  path: z.string().describe('Path of the file to write'),
  content: z.string().describe('The complete text content for the file'),
});

export async function runWriteFile(input: z.output<typeof writeFileSchema>): Promise<string> {
  const resolved = resolveFromCwd(input.path);
  // Assumption: missing parent folders are created so new files can land in new folders.
  await mkdir(path.dirname(resolved), { recursive: true });
  await fsWriteFile(resolved, input.content, 'utf8');
  return `Wrote ${input.content.length} characters to ${input.path}.`;
}