import { execa, type ResultPromise } from 'execa';
import { z } from 'zod';
import { getShell } from '../platform/shell.js';
import { stripQuotes } from '../agent/permissions.js';

export const runBashSchema = z.object({
  command: z.string().describe('The shell command to run'),
});

// Every running command is registered so the exit paths (Ctrl+C, /exit, kill
// signals) can terminate them immediately - the UI must never be left waiting on
// a command the user has already abandoned.
const running = new Set<ResultPromise>();

export function killAllRunningCommands(): void {
  for (const child of running) {
    try {
      child.kill('SIGTERM');
    } catch {
      // Already-exited children must not break the shutdown path.
    }
  }
  running.clear();
}

// Full-screen interactive programs cannot work through this tool: they need the
// keyboard and a live terminal. Refusing them up front is clearer than a hang.
const INTERACTIVE_COMMANDS = new Set(['less', 'more', 'most', 'vi', 'vim', 'nano', 'emacs', 'top', 'htop', 'btop']);

function interactiveCommandIn(command: string): string | null {
  const tokens = stripQuotes(command)
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ''));
  for (const token of tokens) {
    if (INTERACTIVE_COMMANDS.has(token)) return token;
  }
  return null;
}

// A hard ceiling per command: anything still running after this is killed and
// reported to the model, which continues the conversation.
const COMMAND_TIMEOUT_MS = 60_000;

export async function runRunBash(input: z.output<typeof runBashSchema>): Promise<string> {
  const refusal = interactiveCommandIn(input.command);
  if (refusal !== null) {
    throw new Error(
      `${refusal} needs an interactive terminal, which this tool does not provide - it was not run. Use a non-interactive alternative (for example cat or grep) instead.`
    );
  }
  const shell = getShell();
  const child = execa(shell.program, [shell.flag, input.command], {
    reject: false,
    // stdin is /dev/null: a command that reads input gets an immediate end-of-file
    // instead of sitting forever waiting for keystrokes that will never come.
    stdin: 'ignore',
    timeout: COMMAND_TIMEOUT_MS,
    forceKillAfterDelay: 2_000,
  });
  running.add(child);
  try {
    const result = await child;
    if (result.timedOut === true) {
      throw new Error(
        `that command didn't finish in ${COMMAND_TIMEOUT_MS / 1000} seconds - it may be waiting for input. It was stopped.`
      );
    }
    const parts = [`$ ${input.command}`, `exit code: ${result.exitCode ?? 'unknown'}`];
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n\n');
  } finally {
    running.delete(child);
  }
}
