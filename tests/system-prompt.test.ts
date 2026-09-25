import { describe, it, expect } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildTurnMessages } from '../src/agent/context.js';
import { SYSTEM_PROMPT_TEMPLATE, buildSystemPrompt, modelFamily, projectsFolder } from '../src/agent/systemPrompt.js';
import { inputFrameRow } from '../src/ink/cursor.js';

describe('system prompt', () => {
  it('keeps the conversation as history plus the new user message (no role:system - AI SDK 7 rejects it in messages)', () => {
    const messages = buildTurnMessages([], 'hello');
    expect(messages).toEqual([{ role: 'user', content: 'hello' }]);
    const second = buildTurnMessages(messages, 'again');
    expect(second).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'user', content: 'again' },
    ]);
  });

  it('carries the butler identity from the specification', () => {
    for (const rule of [
      "You are Jeeves, a gentleman's personal assistant built by Tianmu Creations.",
      'in the tradition of P.G. Wodehouse',
      'You address the user as {{ADDRESS}}.',
      'Only use tools to complete tasks. Never use a tool — runBash, readFile, anything — to communicate with the user.',
      'This is the most important rule.',
      'Do not create files unless absolutely necessary. Prefer editing an existing file.',
      'Your wit never costs clarity: say the plain fact first.',
      'Write for a person who has not seen your working.',
      'so never use them: say what the thing actually is.',
      'Never put a metaphor or figure of speech in place of a fact.',
      'Be brief, but clarity comes first',
      'Never say "Let me...", "I\'ll now...", "Now let me...", or "First, I will..." before acting.',
      'A task is not finished until you say so in plain words; ending on an unfulfilled intention is not the same as finishing.',
      'always say plainly, in a sentence or two, that a task is finished and what the outcome was - that is required, not optional.',
      'Before reporting a task complete, verify it. Run the command, read the output, check the file.',
      'When a dedicated tool exists, use it instead of runBash.',
      'Reserve runBash for genuine system commands (git, npm, tests, builds) — not for ls, cat, pwd, or echo.',
      'If the user declines a permission, do not ask again for the same action.',
      'Prioritise technical accuracy over validating the user\'s beliefs.',
    ]) {
      expect(SYSTEM_PROMPT_TEMPLATE).toContain(rule);
    }
  });

  it('forbids guessing: checked facts only, general knowledge flagged with an offer to confirm', () => {
    for (const rule of [
      'Facts, Not Guesses',
      'Never guess and never assume.',
      'Only state something as fact when you have checked it in this conversation',
      'That is general knowledge rather than checked fact, {{ADDRESS}}. Shall I confirm it before we rely on it?',
      '"I don\'t know" and "I haven\'t checked that yet" are always acceptable answers.',
      'Never invent file names, folder names, commands, settings, version numbers, prices, dates, or quotations.',
      'Remove any claim you have not checked, or mark it plainly as unchecked.',
    ]) {
      expect(SYSTEM_PROMPT_TEMPLATE).toContain(rule);
    }
    expect(buildSystemPrompt('Sir')).toContain('rather than checked fact, Sir. Shall I confirm it');
  });

  it('substitutes the saved address for {{ADDRESS}}', () => {
    expect(buildSystemPrompt('Madam')).toContain('You address the user as Madam.');
    expect(buildSystemPrompt('Madam')).not.toContain('{{ADDRESS}}');
    expect(buildSystemPrompt('Sir')).not.toContain('{{');
  });

  it("tells the model today's date, so 'this season' is this year's (19 Sept: it answered with 2025)", () => {
    const prompt = buildSystemPrompt('Sir', '2026-09-19', 'morning');
    expect(prompt).toContain("Today's date is 2026-09-19, and it is morning (this computer's own date and clock).");
    expect(prompt).toContain('mean the year of today\'s date: search for that year by name');
    expect(buildSystemPrompt('Sir')).toMatch(/Today's date is \d{4}-\d{2}-\d{2}, and it is (morning|afternoon|evening) /);
  });
});

describe("the projects folder fact (the wrong-drawer folder, 25 Sept: 'create a folder in projects' went into the chat folder)", () => {
  it('works the projects folder out only from real evidence: the most common existing parent, strictly ahead', () => {
    const root = mkdtempSync(path.join(tmpdir(), 'jeeves-projects-'));
    try {
      const projects = path.join(root, 'Documents', 'Projects');
      mkdirSync(path.join(projects, 'Claude Usage Monitor'), { recursive: true });
      mkdirSync(path.join(projects, 'YourNotes Project'), { recursive: true });
      mkdirSync(path.join(projects, 'Income Streams Research'), { recursive: true });
      const documents = path.join(root, 'Documents');
      mkdirSync(path.join(documents, 'Test Project'), { recursive: true });
      mkdirSync(path.join(documents, 'Trading Projects'), { recursive: true });
      const desktop = path.join(root, 'Desktop');
      mkdirSync(path.join(desktop, 'Solo Project'), { recursive: true });
      mkdirSync(path.join(desktop, 'Another Project'), { recursive: true });
      // The owner's real shape, 25 Sept: most projects in one parent, strays
      // elsewhere, plus stale entries from folders renamed or deleted since -
      // the dead paths must not split the vote.
      const recents = [
        path.join(projects, 'Claude Usage Monitor'),
        path.join(projects, 'YourNotes Project'),
        path.join(documents, 'Test Project'),
        path.join(desktop, 'Solo Project'),
        path.join(documents, 'Trading Projects'),
        path.join(projects, 'Income Streams Research'),
        path.join(documents, 'Jeeves CLI Project'), // stale: never created
        path.join(documents, 'Jeeves'), // stale: never created
      ];
      expect(projectsFolder(recents)).toBe(projects);
      // A tie proves nothing: two parents holding two projects each.
      expect(projectsFolder([path.join(documents, 'Test Project'), path.join(documents, 'Trading Projects'), path.join(desktop, 'Solo Project'), path.join(projects, 'Claude Usage Monitor'), path.join(projects, 'YourNotes Project'), path.join(projects, 'Income Streams Research')])).toBe(projects);
      expect(projectsFolder([path.join(documents, 'Test Project'), path.join(documents, 'Trading Projects'), path.join(desktop, 'Solo Project'), path.join(desktop, 'Another Project')])).toBeNull();
      // One project alone proves nothing.
      expect(projectsFolder([path.join(projects, 'Claude Usage Monitor')])).toBeNull();
      expect(projectsFolder([])).toBeNull();
      // A parent equal to the home folder itself can never count - everything shares it.
      const home = os.homedir();
      const homeA = mkdtempSync(path.join(home, 'jeeves-home-test-'));
      const homeB = `${homeA}-two`;
      mkdirSync(homeB, { recursive: true });
      try {
        // Two projects sitting directly in the home folder prove nothing.
        expect(projectsFolder([homeA, homeB])).toBeNull();
      } finally {
        rmSync(homeA, { recursive: true, force: true });
        rmSync(homeB, { recursive: true, force: true });
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('tells the model where the projects live and forbids the wrong-drawer done', () => {
    for (const rule of [
      '{{PROJECTS_FOLDER_FACT}}',
      'say exactly where it went, in everyday words',
      'Never say a thing is done while leaving where it went unclear',
      'ask one short question rather than guessing',
      // 25 Sept: a folder landed in the person's home folder.
      'When the person does not say where a new file or folder goes, it goes in the working directory - never the home folder.',
      "The home folder root (~ itself) is the computer's index, not a drawer: never put anything directly inside it.",
      'name the sensible place (the project folder, or Documents) and get a yes before acting',
    ]) {
      expect(SYSTEM_PROMPT_TEMPLATE).toContain(rule);
    }
    // The env block, both sources' answer to path guessing (OpenCode's
    // session/system.ts <env> block, Claude Code's src/context.ts): the model is
    // told the real working directory, home folder and platform, so it never
    // invents a location.
    const built = buildSystemPrompt('Sir', '2026-09-25', 'morning', null as never, null);
    expect(built).toContain('Here is some useful information about the environment you are running in:');
    expect(built).toMatch(/Working directory: \S.*\(the project folder/);
    expect(built).toMatch(new RegExp(`Home folder: ${os.homedir().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} \\(~ in a path means this folder\\)`));
    expect(built).toContain('Platform: darwin (macOS)');
    expect(built).toContain('Is directory a git repo: yes');
    expect(built).toContain('Use absolute paths in tool calls');
    const withFact = buildSystemPrompt('Sir', '2026-09-25', 'morning', 'glm-5.3-flash', '~/Documents/projects');
    expect(withFact).toContain('The person\'s projects live in ~/Documents/projects. When they say "the projects folder" or "projects", they mean that folder');
    expect(withFact).toContain('say exactly where it went');
    const withoutFact = buildSystemPrompt('Sir', '2026-09-25', 'morning', 'glm-5.3-flash', null);
    expect(withoutFact).not.toContain('projects live in');
    expect(withoutFact).toContain('ask one short question rather than guessing');
    // No placeholder ever survives, and no torn gap is left where the fact was dropped.
    expect(withoutFact).not.toContain('{{');
    expect(withoutFact).not.toMatch(/\n{3,}/);
    expect(withFact).not.toContain('{{');
  });
});

describe('input cursor row geometry', () => {
  it('computes the y that lands the cursor on the input row', () => {
    // Layout A: border 1, transcript rows-7, separator 1, input 1, separator 1,
    // info bar 1, border 1. The input text sits on frame row rows-4; Ink's
    // fullscreen frames draw the cursor one row above the y passed, so
    // inputFrameRow returns rows-3.
    expect(inputFrameRow(24)).toBe(21);
    expect(inputFrameRow(40)).toBe(37);
  });
});

describe('web research rules', () => {
  it('research before stating outside facts, from official sources, with the quote', () => {
    for (const rule of [
      'You have seven tools: readFile, listDir, writeFile, runBash, webSearch, readWebPage, noteResearch.',
      'webSearch to find where to look. Its snippets are not checked facts.',
      "readWebPage on the most official source: the maker's own website, documentation, release list, or registry",
      'State the fact only once readWebPage has returned the exact quote',
      'When {{ADDRESS}} asks directly for such a fact, research it.',
    ]) {
      expect(SYSTEM_PROMPT_TEMPLATE).toContain(rule);
    }
  });
});

describe('per-model-family instructions (OpenCode\'s answer to running on any company\'s models)', () => {
  it('sorts every model id into its family, vendor prefixes and all', () => {
    expect(modelFamily('glm-5.3-flash')).toBe('glm');
    expect(modelFamily('z-ai/glm-5.3')).toBe('glm');
    expect(modelFamily('claude-sonnet-5')).toBe('claude');
    expect(modelFamily('anthropic/claude-fable-5')).toBe('claude');
    expect(modelFamily('gpt-5.6-luna')).toBe('gpt');
    expect(modelFamily('openai/gpt-4o')).toBe('gpt');
    expect(modelFamily('o3-pro')).toBe('gpt');
    expect(modelFamily('codex-mini')).toBe('gpt');
    expect(modelFamily('gemini-3-flash')).toBe('gemini');
    expect(modelFamily('google/gemini-3.8-flash')).toBe('gemini');
    // Everything else - DeepSeek, Mistral, Llama, Qwen - gets the core alone.
    expect(modelFamily('deepseek-v4-flash')).toBe('default');
    expect(modelFamily('mistral-medium-2604')).toBe('default');
  });

  it('appends the family note for the family in use, and nothing for default or claude', () => {
    expect(buildSystemPrompt('Sir', '2026-09-24', 'morning', 'glm-5.3-flash')).toContain('Model notes');
    expect(buildSystemPrompt('Sir', '2026-09-24', 'morning', 'gpt-5.6')).toContain('No lectures');
    expect(buildSystemPrompt('Sir', '2026-09-24', 'morning', 'gemini-3-flash')).toContain('Never narrate a plan');
    expect(buildSystemPrompt('Sir', '2026-09-24', 'morning', 'claude-sonnet-5')).not.toContain('Model notes');
    expect(buildSystemPrompt('Sir', '2026-09-24', 'morning', 'deepseek-v4-flash')).not.toContain('Model notes');
    // No model id (old callers): unchanged prompt.
    expect(buildSystemPrompt('Sir', '2026-09-24', 'morning')).not.toContain('Model notes');
  });

  it('every family keeps the core rulebook - the family note only adds', () => {
    const base = buildSystemPrompt('Sir', '2026-09-24', 'morning', 'claude-sonnet-5');
    for (const id of ['glm-5.3-flash', 'gpt-5.6', 'gemini-3-flash']) {
      const tuned = buildSystemPrompt('Sir', '2026-09-24', 'morning', id);
      expect(tuned.startsWith(base)).toBe(true);
    }
  });
});

// The measured GLM drifts (25 Sept): after a decline it offered "Say the word if
// you'd like me to try again", and its working-out ("The user denied... I should
// accept it in one short sentence") showed in the transcript as reply text.
describe('the model-manners rules (measured drifts)', () => {
  it('the decline rule forbids try-again offers as well as alternatives', () => {
    expect(SYSTEM_PROMPT_TEMPLATE).toContain('do not offer to try again later');
  });

  it('the GLM note forbids writing deliberation into the reply', () => {
    const prompt = buildSystemPrompt('Sir', '2026-09-25', 'morning', 'glm-5.3-flash');
    expect(prompt).toContain('never a place to think');
    expect(prompt).toContain('no offer to try again');
    // The other families carry no such note - the drift was measured on GLM.
    expect(buildSystemPrompt('Sir', '2026-09-25', 'morning', 'claude-sonnet-5')).not.toContain('never a place to think');
  });
});
