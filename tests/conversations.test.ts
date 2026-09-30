import { describe, it, expect, beforeEach } from 'vitest';
import { saveConversation, listConversations, resumeConversation, deleteConversation, startNewConversation, ago } from '../src/platform/conversations.js';
import { clearConversation } from '../src/commands/clear.js';
import { session } from '../src/state/session.js';

beforeEach(() => {
  for (const chat of listConversations()) deleteConversation(chat.id);
  clearConversation();
});

describe('saved conversations (Claude Code resume / OpenCode session list)', () => {
  it('saves as it goes, lists by first message, and carries on where it stopped', () => {
    session.addUser('Please tidy my invoices folder');
    session.setHistory([{ role: 'user', content: 'Please tidy my invoices folder' }, { role: 'assistant', content: 'Done.' }] as never);
    saveConversation();
    saveConversation();
    const list = listConversations();
    expect(list).toHaveLength(1);
    expect(list[0].title).toBe('Please tidy my invoices folder');
    clearConversation();
    expect(session.transcript).toHaveLength(0);
    expect(session.history).toHaveLength(0);
    expect(resumeConversation(list[0].id)).toBe(true);
    expect(session.transcript.some((e) => e.kind === 'user' && e.text.includes('invoices'))).toBe(true);
    expect(session.history).toHaveLength(2);
    // The next message goes on the same file, not a new one.
    session.addUser('And the receipts too');
    saveConversation();
    expect(listConversations()).toHaveLength(1);
  });
  it('a new conversation is a new file, and the earlier one stays', () => {
    session.addUser('First chat');
    saveConversation();
    clearConversation();
    session.addUser('Second chat');
    saveConversation();
    expect(listConversations().map((c) => c.title).sort()).toEqual(['First chat', 'Second chat']);
    startNewConversation();
  });
  it('nothing is saved before the person has said something, and deleting works', () => {
    saveConversation();
    expect(listConversations()).toHaveLength(0);
    session.addUser('Hello');
    saveConversation();
    deleteConversation(listConversations()[0].id);
    expect(listConversations()).toHaveLength(0);
  });
  it('says how long ago in plain words', () => {
    const now = Date.now();
    expect(ago(now - 30_000, now)).toBe('just now');
    expect(ago(now - 3 * 3_600_000, now)).toBe('3 hours ago');
    expect(ago(now - 26 * 3_600_000, now)).toBe('yesterday');
  });
});
