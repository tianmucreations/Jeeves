import { describe, it, expect } from 'vitest';
import { plainError } from '../src/agent/errors.js';
import { plainToolFailure } from '../src/tools/index.js';
import { COMMANDS, KEY_BINDINGS } from '../src/commands/help.js';

describe('plain-English error translation', () => {
  it('explains a missing key', () => {
    const result = plainError(new Error('No OpenRouter API key found. Add one with /keys.'));
    expect(result.message).toContain('/keys');
    expect(result.kind).toBe('auth');
  });

  it('explains a rejected key', () => {
    const result = plainError(new Error('Request failed with 401 Unauthorized'));
    expect(result.message).toContain("wasn't accepted");
    expect(result.kind).toBe('auth');
  });

  it('explains running out of credit', () => {
    const result = plainError(new Error('402 Insufficient credits'));
    expect(result.message).toContain('credit ran out');
    expect(result.kind).toBe('payment');
  });

  it('explains rate limits', () => {
    const result = plainError(new Error('429 Too Many Requests'));
    expect(result.message).toContain('slow down');
    expect(result.kind).toBe('rate-limit');
  });

  it('explains network drops', () => {
    const result = plainError(new Error('fetch failed'));
    expect(result.message).toContain('Lost connection');
    expect(result.kind).toBe('network');
  });

  it('explains a vanished model', () => {
    const result = plainError(new Error('Model z-ai/glm-9 not found (404)'));
    expect(result.message).toContain('/model');
    expect(result.kind).toBe('model');
  });

  it('explains an over-long conversation', () => {
    const result = plainError(new Error('Prompt is too long: context length exceeded'));
    expect(result.message).toContain('too long');
    expect(result.kind).toBe('context');
  });

  it('falls back to the first line of unknown errors', () => {
    const result = plainError(new Error('Something odd happened\nwith a stack trace'));
    expect(result.message).toBe('Something odd happened');
    expect(result.kind).toBe('other');
  });
});

describe('plain tool failures', () => {
  it('translates common file errors', () => {
    expect(plainToolFailure(new Error("ENOENT: no such file, 'x.txt'"))).toBe('file or folder not found');
    expect(plainToolFailure(new Error('EACCES: permission denied'))).toBe('permission denied');
    expect(plainToolFailure(new Error('The command was stopped after 2 minutes.'))).toBe('took too long');
    expect(plainToolFailure(new Error('This looks like a binary file; it cannot be read as text.'))).toBe('not a text file');
  });
});

describe('help data', () => {
  it('lists every command with a description', () => {
    const names = COMMANDS.map((entry) => entry.command);
    for (const expected of ['/help', '/model', '/keys', '/verbose', '/clear', '/exit']) {
      expect(names).toContain(expected);
    }
    for (const entry of COMMANDS) {
      expect(entry.description.length).toBeGreaterThan(3);
    }
  });

  it('lists the key bindings with descriptions', () => {
    expect(KEY_BINDINGS.length).toBeGreaterThanOrEqual(5);
    for (const entry of KEY_BINDINGS) {
      expect(entry.description.length).toBeGreaterThan(3);
    }
  });
});