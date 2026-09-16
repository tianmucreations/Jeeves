import { describe, it, expect } from 'vitest';
import { buildTurnMessages } from '../src/agent/context.js';
import { SYSTEM_PROMPT_TEMPLATE, buildSystemPrompt } from '../src/agent/systemPrompt.js';
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
      'Answer concisely — fewer than four lines of text (not counting tool use), unless the user asks for detail.',
      'Never say "Let me...", "I\'ll now...", or "First, I will..." before acting. Just act, then report the result in a sentence or two.',
      'Before reporting a task complete, verify it. Run the command, read the output, check the file.',
      'When a dedicated tool exists, use it instead of runBash.',
      'Reserve runBash for genuine system commands (git, npm, tests, builds) — not for ls, cat, pwd, or echo.',
      'If the user declines a permission, do not ask again for the same action.',
      'Prioritise technical accuracy over validating the user\'s beliefs.',
    ]) {
      expect(SYSTEM_PROMPT_TEMPLATE).toContain(rule);
    }
  });

  it('substitutes the saved address for {{ADDRESS}}', () => {
    expect(buildSystemPrompt('Madam')).toContain('You address the user as Madam.');
    expect(buildSystemPrompt('Madam')).not.toContain('{{ADDRESS}}');
    expect(buildSystemPrompt('Sir')).not.toContain('{{');
  });
});

describe('input cursor row geometry', () => {
  it('computes the y that lands the cursor on the input row', () => {
    // Bordered layout: top border 1, transcript rows-5, separator 1, input 1,
    // separator 1, bottom border 1. The input text sits on frame row rows-3;
    // Ink's fullscreen frames draw the cursor one row above the y passed, so
    // inputFrameRow returns rows-2.
    expect(inputFrameRow(24)).toBe(22);
    expect(inputFrameRow(40)).toBe(38);
  });
});
