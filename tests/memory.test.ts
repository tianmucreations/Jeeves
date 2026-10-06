import { describe, it, expect, beforeEach } from 'vitest';
import { addNote, removeNote, notesAboutMe, notesAboutFolder, allNotes, memoryBlock, MAX_NOTES, MAX_NOTE_CHARS } from '../src/platform/memory.js';
import { runMemory } from '../src/tools/memory.js';
import { getSystemPrompt } from '../src/agent/systemPrompt.js';
import { TOOLS } from '../src/tools/index.js';

beforeEach(() => {
  for (const n of allNotes()) removeNote(n.id);
});

describe('remembering between conversations (Claude Code memdir / OpenCode AGENTS.md)', () => {
  it('keeps notes about the person and about one folder, without repeats', () => {
    expect(addNote('me', 'Likes short answers')).toBe('added');
    expect(addNote('me', '  likes SHORT answers ')).toBe('duplicate');
    expect(addNote('folder', 'This folder holds business invoices')).toBe('added');
    expect(addNote('folder', '')).toBe('empty');
    expect(notesAboutMe().map((n) => n.text)).toEqual(['Likes short answers']);
    expect(notesAboutFolder().map((n) => n.text)).toEqual(['This folder holds business invoices']);
    expect(notesAboutFolder('/somewhere/else')).toEqual([]);
  });
  it('puts the notes in the rulebook, and nothing when there are none', () => {
    expect(memoryBlock()).toBe('');
    expect(getSystemPrompt()).not.toContain('What You Remember');
    addNote('me', 'Call the person Doctor');
    addNote('folder', 'Invoices are named by month');
    const prompt = getSystemPrompt();
    expect(prompt).toContain('What You Remember');
    expect(prompt).toContain('About the person:\n- Call the person Doctor');
    expect(prompt).toContain('About this folder:\n- Invoices are named by month');
  });
  it('forgets by id or by the words, and says when nothing matches', () => {
    addNote('me', 'Prefers metric units');
    addNote('me', 'Has a dog called Biscuit');
    expect(removeNote('biscuit dog')?.text).toBe('Has a dog called Biscuit');
    expect(removeNote('nothing like this at all')).toBeNull();
    const id = notesAboutMe()[0].id;
    expect(removeNote(id)?.text).toBe('Prefers metric units');
    expect(notesAboutMe()).toEqual([]);
  });
  it('is capped: long notes are cut and a full memory says so', () => {
    addNote('me', 'x'.repeat(MAX_NOTE_CHARS + 100));
    expect(notesAboutMe()[0].text.length).toBe(MAX_NOTE_CHARS);
    for (let i = 1; i < MAX_NOTES; i++) addNote('me', `note number ${i}`);
    expect(addNote('me', 'one too many')).toBe('full');
  });
  it('the memory tool remembers, lists and forgets, in plain words', async () => {
    expect(runMemory({ action: 'remember', note: 'Works in pounds', about: 'me' })).toBe('Remembered: Works in pounds');
    expect(runMemory({ action: 'remember', note: 'Works in pounds', about: 'me' })).toBe('Already remembered.');
    expect(runMemory({ action: 'list' })).toContain('(me) Works in pounds');
    expect(runMemory({ action: 'forget', note: 'pounds' })).toBe('Forgot: Works in pounds');
    expect(runMemory({ action: 'forget', note: 'pounds' })).toContain('No remembered note');
    const viaTool = await TOOLS.memory.execute!({ action: 'remember', note: 'Prefers plain words', about: 'me' }, { toolCallId: 't', messages: [] } as never);
    expect(String(viaTool)).toContain('Remembered');
  });
});
