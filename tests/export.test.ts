import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { plainText, lastAnswer, conversationText, conversationFileName, saveConversationFile } from '../src/commands/export.js';
import { runCommand } from '../src/commands/registry.js';
import { session } from '../src/state/session.js';
import { clearConversation } from '../src/commands/clear.js';

let dir = '';
beforeEach(() => {
  clearConversation();
  session.clearTranscript();
  dir = mkdtempSync(path.join(tmpdir(), 'jeeves-export-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));
const when = new Date(2026, 8, 30, 14, 5);

describe('copy the last answer, save the conversation (Claude Code /copy and /export, OpenCode export)', () => {
  it('finds the last answer, and says so when there is none', async () => {
    expect(lastAnswer()).toBeNull();
    await runCommand('/copy');
    expect(session.transcript.some((e) => e.kind === 'notice' && e.text.includes('no answer to copy'))).toBe(true);
    session.addUser('hi');
    const id = session.startAssistant();
    session.setAssistantText(id, 'First answer');
    session.finishAssistant(id);
    const id2 = session.startAssistant();
    session.setAssistantText(id2, '  Second answer  ');
    session.finishAssistant(id2);
    expect(lastAnswer()).toBe('Second answer');
  });
  it('writes the conversation as plain readable text, named from the first message and the time', () => {
    session.addUser('Please write a letter to my landlord!');
    const id = session.startAssistant();
    session.setAssistantText(id, 'Dear Landlord, ...');
    session.finishAssistant(id);
    session.addNotice('a note that is not part of the conversation');
    const text = conversationText(session.transcript, dir, when);
    expect(text).toContain('Conversation with Jeeves');
    expect(text).toContain('You: Please write a letter to my landlord!');
    expect(text).toContain('Jeeves: Dear Landlord, ...');
    expect(text).not.toContain('a note that is not');
    expect(conversationFileName(session.transcript, when)).toBe('Conversation - Please write a letter to my landlord - 2026-09-30 1405.txt');
  });
  it('saves into the folder, never over an earlier file, and says nothing is there before anyone has spoken', async () => {
    expect(saveConversationFile(dir, when)).toBeNull();
    session.addUser('Tidy my invoices');
    const first = saveConversationFile(dir, when)!;
    const second = saveConversationFile(dir, when)!;
    expect(path.basename(first)).toBe('Conversation - Tidy my invoices - 2026-09-30 1405.txt');
    expect(path.basename(second)).toBe('Conversation - Tidy my invoices - 2026-09-30 1405 (2).txt');
    expect(readFileSync(first, 'utf8')).toContain('You: Tidy my invoices');
    expect(readdirSync(dir)).toHaveLength(2);
    expect(existsSync(first)).toBe(true);
  });
  it('are buttons in Settings, from the one table of commands', async () => {
    const { COMMAND_TABLE } = await import('../src/commands/registry.js');
    const both = COMMAND_TABLE.filter((c) => c.command === '/copy' || c.command === '/save');
    expect(both.map((c) => c.label)).toEqual(['Copy last answer', 'Save conversation as a document']);
    expect(both.every((c) => c.place === 'conversation')).toBe(true);
  });
});

describe('copies and saved files carry plain text, not formatting marks', () => {
  it('removes the marks but keeps the words, lists and web addresses', () => {
    expect(plainText('## Chapter 1\n\n**Kingdoms** rose and *ideas* travelled.\n- Trade with `Córdoba`\n[Docs](https://example.com/a)')).toBe(
      'Chapter 1\n\nKingdoms rose and ideas travelled.\n- Trade with Córdoba\nDocs (https://example.com/a)'
    );
    expect(plainText('2 * 3 = 6 and 4*5')).toBe('2 * 3 = 6 and 4*5');
    expect(plainText('```js\nlet a = 1\n```')).toBe('let a = 1\n');
  });
});
