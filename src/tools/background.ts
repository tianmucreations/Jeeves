import { execa, type ResultPromise } from 'execa';
import { z } from 'zod';
import { getShell } from '../platform/shell.js';
import { session } from '../state/session.js';
import { describeCommand } from './describe.js';
import { terminate } from './terminate.js';

// Commands left running while Jeeves carries on (a test server, a build watcher) -
// Claude Code's background "shell" tasks (tasks/LocalShellTask), whose count shows at
// the bottom of its window. Here the count is worded in plain English and the person
// can ask about them, or stop them, without interrupting anything.
//
// Their output is kept (the last 30,000 characters) so Jeeves can look at it on
// request. Pressing Esc stops the current job but never these; leaving Jeeves does.
const KEEP_CHARS = 30_000;

export interface BackgroundTask {
  id: number;
  command: string;
  // What the person sees instead of the command: "Started a website preview".
  plain: string;
  startedAt: number;
  status: 'running' | 'finished' | 'stopped';
  exitCode: number | null;
  output: string;
}

const tasks = new Map<number, BackgroundTask>();
const children = new Map<number, ResultPromise>();
let nextId = 1;

// The running ones, for the bottom bar and the list.
export function runningTasks(): BackgroundTask[] {
  return [...tasks.values()].filter((task) => task.status === 'running');
}

function publish(): void {
  session.setBackgroundTasks(runningTasks().map((task) => ({ id: task.id, plain: task.plain, startedAt: task.startedAt })));
}

export function startBackground(command: string): BackgroundTask {
  const shell = getShell();
  // Its own process group, so Stop reaches the programs it started (a server), not just the shell.
  const child = execa(shell.program, [shell.flag, command], { reject: false, stdin: 'ignore', all: true, detached: process.platform !== 'win32' });
  const task: BackgroundTask = { id: nextId++, command, plain: describeCommand(command), startedAt: Date.now(), status: 'running', exitCode: null, output: '' };
  tasks.set(task.id, task);
  children.set(task.id, child);
  child.all?.on('data', (chunk: Buffer) => {
    task.output = (task.output + chunk.toString()).slice(-KEEP_CHARS);
  });
  void child.then((result) => {
    if (task.status === 'running') task.status = 'finished';
    task.exitCode = result.exitCode ?? null;
    children.delete(task.id);
    publish();
  });
  publish();
  return task;
}

export function stopBackground(id: number): boolean {
  const task = tasks.get(id);
  if (!task || task.status !== 'running') return false;
  task.status = 'stopped';
  const child = children.get(id);
  if (child) terminate(child, { group: true });
  publish();
  return true;
}

// The person's Stop button in the tasks panel (/tasks): the same door the
// backgroundTask tool opens for the model, for the human.
export function stopBackgroundById(id: number): void {
  if (stopBackground(id)) session.addNotice(`Stopped background task #${id}.`);
}

export function killBackgroundTasks(): void {
  for (const child of children.values()) terminate(child, { group: true });
  children.clear();
}

// For tests.
export function resetBackground(): void {
  killBackgroundTasks();
  tasks.clear();
  nextId = 1;
  publish();
}

export const backgroundTaskSchema = z.object({
  action: z.enum(['list', 'read', 'stop']).describe('list: every task; read: its latest output; stop: end it'),
  id: z.number().optional().describe('The task number (for read and stop)'),
});

export function runBackgroundTask(input: z.output<typeof backgroundTaskSchema>): string {
  if (input.action === 'list') {
    if (tasks.size === 0) return 'No background tasks.';
    return [...tasks.values()].map((task) => `#${task.id} ${task.status}${task.exitCode !== null ? ` (exit ${task.exitCode})` : ''}: ${task.command}`).join('\n');
  }
  const task = input.id === undefined ? undefined : tasks.get(input.id);
  if (!task) return `There is no background task ${input.id ?? ''}. Use action "list".`;
  if (input.action === 'stop') return stopBackground(task.id) ? `Stopped task #${task.id}.` : `Task #${task.id} was not running (${task.status}).`;
  return `#${task.id} ${task.status}: ${task.command}\n\n${task.output || '(no output yet)'}`;
}
