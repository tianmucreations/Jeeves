import { execa, type ResultPromise } from 'execa';
import { z } from 'zod';
import { getShell } from '../platform/shell.js';
import { expandPath, currentShellCwd, setShellCwd } from '../platform/paths.js';
import { stripHeredoc, splitOutsideQuotes } from '../agent/command-family.js';
import { stripQuotes } from '../agent/permissions.js';
import { startBackground, killBackgroundTasks } from './background.js';
import { terminate } from './terminate.js';


// Claude Code's limits (utils/timeouts.ts): 2 minutes unless the model asks for
// more, 10 minutes at most. Jeeves had 60 seconds, which cut off every large
// download or install (owner's screenshot, 19 Sept).
export const DEFAULT_COMMAND_MS = 120_000;
export const MAX_COMMAND_MS = 600_000;

export const runBashSchema = z.object({
  command: z.string().describe('The shell command to run'),
  timeout: z
    .number()
    .optional()
    .describe(`How long the command may run, in milliseconds - up to ${MAX_COMMAND_MS} (10 minutes). Without it: ${DEFAULT_COMMAND_MS} (2 minutes). Ask for more for downloads, installs and builds.`),
  background: z
    .boolean()
    .optional()
    .describe('true: start it and carry on without waiting, for a server or watcher that keeps running. Look at it later with the backgroundTask tool.'),
});

// Every running command is registered so the exit paths (Ctrl+C, /exit, kill
// signals) can terminate them immediately - the UI must never be left waiting on
// a command the user has already abandoned.
const running = new Set<ResultPromise>();

// Ends the commands a job is waiting on. Commands left running in the background are
// not touched (see background.ts): Esc stops the job, not the website preview.
export function killForegroundCommands(): void {
  for (const child of running) terminate(child, { group: true });
  running.clear();
}

// Leaving Jeeves: everything goes, background tasks included.
export function killAllRunningCommands(): void {
  killForegroundCommands();
  killBackgroundTasks();
}

// Full-screen interactive programs cannot work through this tool: they need the
// keyboard and a live terminal. Refusing them up front is clearer than a hang.
const INTERACTIVE_COMMANDS = new Set(['less', 'more', 'most', 'vi', 'vim', 'nano', 'emacs', 'top', 'htop', 'btop']);

// ─────────────────────────────────────────────────────────────────────────────
// THE WORKING DIRECTORY CARRIES OVER, as in Claude Code's shell (the model once
// ran `cd "…" && python3 …` seven times in one job — every command forgot where
// it was, because each one started fresh in the project folder). The directory
// itself lives in platform/paths.ts, where the file tools can resolve relative
// paths against it too; a bare `cd` changes it silently, and every later
// command runs there. The person changing folders resets it.

// A command that ONLY changes directory (no chaining, no pipes, no redirects,
// nothing else on the line): it is never shown, never asks, and leaves the
// remembered directory pointing at the new place. Returns the directory it
// moves to, or null.
export function bareCdTarget(command: string): string | null {
  const text = stripHeredoc(command.trim());
  if (text.includes('\n') || text.includes('&')) return null;
  if (/[<>`]|\$\(/.test(text)) return null; // a redirect or substitution is more than a cd
  for (const separator of ['&&', '||', '|', ';']) {
    if (splitOutsideQuotes(text, separator).length > 1) return null;
  }
  const match = text.match(/^cd(?:\s+(?:-[LP]\s+)?(.+))?$/);
  if (!match) return null;
  const target = match[1]?.trim().replace(/^"(.*)"$/, '$1').replace(/^'(.*)'$/, '$1') ?? '~';
  if (target.startsWith('-')) return null; // `cd -` and flags: let the shell handle it in a normal run
  try {
    return expandPath(target, currentShellCwd());
  } catch {
    return null;
  }
}

function interactiveCommandIn(command: string): string | null {
  const tokens = stripQuotes(command)
    .split(/\s+/)
    .map((token) => token.replace(/^['"]|['"]$/g, ''));
  for (const token of tokens) {
    if (INTERACTIVE_COMMANDS.has(token)) return token;
  }
  return null;
}


export function describeLimit(ms: number): string {
  return ms % 60_000 === 0 ? `${ms / 60_000} minute${ms === 60_000 ? '' : 's'}` : `${Math.round(ms / 1000)} seconds`;
}

export async function runRunBash(input: z.output<typeof runBashSchema>, signal?: AbortSignal): Promise<string> {
  // Heredoc text is data being fed to the command, not the command itself - the
  // refusal must judge the command, so ordinary words in the text ("more", "top")
  // cannot be mistaken for programs.
  const refusal = interactiveCommandIn(stripHeredoc(input.command));
  if (refusal !== null) {
    throw new Error(
      `${refusal} needs an interactive terminal, which this tool does not provide - it was not run. Use a non-interactive alternative (for example cat or grep) instead.`
    );
  }
  if (input.background) {
    const task = startBackground(input.command);
    return `Started in the background as task #${task.id}. It keeps running while we carry on; use the backgroundTask tool (action "read" or "stop", id ${task.id}) to look at it or end it.`;
  }
  // A bare `cd` never reaches the shell: it just moves the remembered working
  // directory (silently - the person sees nothing, as in Claude Code).
  const cdTarget = bareCdTarget(input.command);
  if (cdTarget !== null) {
    setShellCwd(cdTarget);
    return `Now in ${cdTarget}`;
  }
  // A hard ceiling per command: anything still running after this is killed and
  // reported to the model, which continues the conversation.
  const limit = Math.min(Math.max(input.timeout ?? DEFAULT_COMMAND_MS, 1_000), MAX_COMMAND_MS);
  const shell = getShell();
  const child = execa(shell.program, [shell.flag, input.command], {
    reject: false,
    cwd: currentShellCwd(),
    // stdin is /dev/null: a command that reads input gets an immediate end-of-file
    // instead of sitting forever waiting for keystrokes that will never come.
    stdin: 'ignore',
    // Its own process group, so ending it reaches the programs it started as well (a
    // program left holding the output open kept a stopped command "running").
    detached: process.platform !== 'win32',
  });
  running.add(child);
  // The time limit is kept here (not by execa) so that it ends the whole group, politely and then by force.
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    terminate(child, { group: true });
  }, limit);
  // The job's stop signal reaches the command now (the race fix, 3 Oct): Esc ends
  // the command actually running, not just the loop around it. The signal was
  // accepted by the tool layer before but never passed down this far.
  const onAbort = () => terminate(child, { group: true });
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }
  try {
    const result = await child;
    if (timedOut) {
      throw new Error(
        `that command didn't finish in ${describeLimit(limit)} - it may be waiting for input, or need longer (up to 10 minutes can be asked for). It was stopped.`
      );
    }
    if (signal?.aborted) {
      throw abortedError();
    }
    const parts = [`$ ${input.command}`, `exit code: ${result.exitCode ?? 'unknown'}`];
    if (result.stdout) parts.push(`stdout:\n${result.stdout}`);
    if (result.stderr) parts.push(`stderr:\n${result.stderr}`);
    return parts.join('\n\n');
  } finally {
    clearTimeout(timer);
    if (signal) signal.removeEventListener('abort', onAbort);
    running.delete(child);
  }
}

function abortedError(): Error {
  // Named as the SDK names its own, so the plain-English "stopped" path stays the same.
  const error = new Error('The command was stopped.');
  error.name = 'AbortError';
  return error;
}
