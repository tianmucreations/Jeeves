import { z } from 'zod';
import { session } from '../state/session.js';

// The job's checklist, as Claude Code's TodoWrite and OpenCode's todowrite: the model
// sends the whole list each time, with each step pending, in progress or done, and
// the person watches it tick off. Kept in the session, shown on screen while any step
// is left.
export const todoListSchema = z.object({
  todos: z
    .array(
      z.object({
        content: z.string().min(1),
        status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']),
      })
    )
    .describe('The whole list, in order'),
});

export type TodoItem = z.output<typeof todoListSchema>['todos'][number];

export function runTodoList(input: z.output<typeof todoListSchema>): string {
  session.setTodos(input.todos);
  const left = input.todos.filter((todo) => todo.status === 'pending' || todo.status === 'in_progress').length;
  return `To-do list updated (${left} still to do). Carry on with the step in progress, and keep the list current.`;
}

// Whether the list has anything left to show.
export function todosUnfinished(todos: TodoItem[]): boolean {
  return todos.some((todo) => todo.status === 'pending' || todo.status === 'in_progress');
}

// THE ONE-LINE CHECKLIST (owner, 3 Oct: the bullet-point boxes are banned).
// The whole list was drawn as a box of bullets above the typing area and it
// cluttered the window; now the checklist is ONE compact line that updates in
// place, naming the step in progress - a friendly cue, not a wall of dots.
export function todoHeadline(todos: TodoItem[]): string | null {
  const open = todos.filter((todo) => todo.status === 'pending' || todo.status === 'in_progress');
  if (open.length === 0) return null;
  const done = todos.length - open.length;
  const current = open.find((todo) => todo.status === 'in_progress') ?? open[0];
  const clip = (text: string) => (text.length > 48 ? text.slice(0, 47) + '…' : text);
  return `Step ${todos.length - open.length + 1} of ${todos.length}: ${clip(current.content)}${done > 0 ? ` (${done} done)` : ''}`;
}

// The lines the screen draws: at most `max`, keeping the step in progress in view.
export function todoLines(todos: TodoItem[], max = 6): string[] {
  const mark = (todo: TodoItem) => (todo.status === 'completed' ? '✓' : todo.status === 'in_progress' ? '●' : todo.status === 'cancelled' ? '✗' : '○');
  const lines = todos.map((todo) => `${mark(todo)} ${todo.content}`);
  if (lines.length <= max) return lines;
  // Too many: fold the finished ones into one line at the top, then the rest that fit.
  const done = todos.filter((todo) => todo.status === 'completed' || todo.status === 'cancelled').length;
  const open = todos.filter((todo) => todo.status !== 'completed' && todo.status !== 'cancelled');
  const shown = open.slice(0, max - 1).map((todo) => `${mark(todo)} ${todo.content}`);
  const hidden = open.length - shown.length;
  return [`✓ ${done} done${hidden > 0 ? `, ${hidden} more below` : ''}`, ...shown].slice(0, max);
}
