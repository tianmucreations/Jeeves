import { execa } from 'execa';
import { z } from 'zod';
import { getShell } from '../platform/shell.js';

export const runBashSchema = z.object({
  command: z.string().describe('The shell command to run'),
});

export async function runRunBash(input: z.output<typeof runBashSchema>): Promise<string> {
  const shell = getShell();
  // Assumption: a two-minute cap stops a runaway command from hanging the session forever.
  const result = await execa(shell.program, [shell.flag, input.command], {
    reject: false,
    timeout: 120_000,
  });
  const parts = [`$ ${input.command}`, `exit code: ${result.exitCode ?? 'unknown'}`];
  if (result.timedOut === true) parts.push('The command was stopped after 2 minutes.');
  if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
  if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
  return parts.join('\n\n');
}