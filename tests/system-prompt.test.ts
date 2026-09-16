import { describe, it, expect } from 'vitest';
import { buildTurnMessages, SYSTEM_PROMPT } from '../src/agent/context.js';
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

  it('contains the Claude Code rules verbatim', () => {
    for (const rule of [
      'Only use tools to complete tasks. Never use tools as a means to communicate with the user.',
      'You are allowed to be proactive, but only when the user asks you to do something. If the user asks a question or makes a general remark, answer directly first - do not immediately jump into taking actions.',
      "Do not create files unless they're absolutely necessary.",
      "Never propose changes to code you haven't read.",
      'When a dedicated tool exists, do not fall back to Bash.',
      'Be concise. Lead with the answer, not the reasoning. Skip filler words, preamble, and unnecessary transitions.',
      'Your output will be displayed in a command-line interface. Keep responses short.',
      'Do not add emoji unless the user asks.',
      'IMPORTANT: Go straight to the point. Try the simplest approach first without going in circles. Do not overdo it.',
    ]) {
      expect(SYSTEM_PROMPT).toContain(rule);
    }
  });

  it('is exported for the provider instructions option', () => {
    expect(SYSTEM_PROMPT.startsWith('# Identity')).toBe(true);
    expect(SYSTEM_PROMPT).toContain('You are Jeeves');
  });
});

describe('input cursor row geometry', () => {
  it('computes the 0-based frame row of the input line', () => {
    // Slot layout: header 1, transcript rows-4, input slot 2 (separator + prompt),
    // footer 1. The prompt text sits on the second row of the input slot.
    expect(inputFrameRow(24)).toBe(22);
    expect(inputFrameRow(40)).toBe(38);
  });
});
