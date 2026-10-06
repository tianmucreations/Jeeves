import { describe, it, expect, beforeEach } from 'vitest';
import { runTodoList, todoLines, todosUnfinished } from '../src/tools/todoList.js';
import { TOOLS } from '../src/tools/index.js';
import { session } from '../src/state/session.js';
import { clearConversation } from '../src/commands/clear.js';
import { saveConversation, resumeConversation, listConversations, deleteConversation } from '../src/platform/conversations.js';

beforeEach(() => {
  for (const chat of listConversations()) deleteConversation(chat.id);
  clearConversation();
});
const list = [
  { content: 'Find the invoices', status: 'completed' as const },
  { content: 'Rename them', status: 'in_progress' as const },
  { content: 'Make a summary', status: 'pending' as const },
];

describe('to-do list (Claude Code TodoWrite / OpenCode todowrite)', () => {
  it('replaces the whole list, and says how many steps are left', () => {
    expect(runTodoList({ todos: list })).toContain('2 still to do');
    expect(session.todos).toHaveLength(3);
    expect(todosUnfinished(session.todos)).toBe(true);
    runTodoList({ todos: list.map((t) => ({ ...t, status: 'completed' as const })) });
    expect(todosUnfinished(session.todos)).toBe(false);
  });
  it('draws ticks, the current step and waiting steps; folds a long list', () => {
    expect(todoLines(list)).toEqual(['✓ Find the invoices', '● Rename them', '○ Make a summary']);
    const long = Array.from({ length: 12 }, (_, i) => ({ content: `Step ${i}`, status: i < 4 ? ('completed' as const) : ('pending' as const) }));
    const lines = todoLines(long, 6);
    expect(lines).toHaveLength(6);
    expect(lines[0]).toContain('4 done');
  });
  it('is a quiet tool that never asks, starts fresh with a new conversation, and survives resume', async () => {
    await TOOLS.todoList.execute!({ todos: list }, { toolCallId: 't', messages: [] } as never);
    session.addUser('Tidy my invoices');
    saveConversation();
    clearConversation();
    expect(session.todos).toHaveLength(0);
    expect(resumeConversation(listConversations()[0].id)).toBe(true);
    expect(session.todos).toHaveLength(3);
  });
});
