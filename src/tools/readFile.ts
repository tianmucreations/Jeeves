import { readFile as fsReadFile } from 'node:fs/promises';
import { z } from 'zod';
import { resolveFromCwd } from '../platform/paths.js';

export const readFileSchema = z.object({
  path: z.string().describe("The absolute path to the file to read. A leading ~ means the home folder; a relative path is resolved against the working directory."),
});

export async function runReadFile(input: z.output<typeof readFileSchema>): Promise<string> {
  const resolved = resolveFromCwd(input.path);
  const contents = await fsReadFile(resolved, 'utf8');
  // Guard against feeding binary files into the conversation as gibberish.
  if (contents.slice(0, 1000).includes('\u0000')) {
    throw new Error('This looks like a binary file; it cannot be read as text.');
  }
  return contents;
}