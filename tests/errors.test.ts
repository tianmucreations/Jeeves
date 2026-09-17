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
    expect(result.message).toContain("didn't accept the key");
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
    expect(result.message).toContain("Couldn't reach OpenRouter");
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

  it('keeps unknown technical errors off screen, but available as detail', () => {
    const result = plainError(new Error('AI_TypeValidationError: Type validation failed\nat stack'));
    expect(result.message).not.toMatch(/AI_|Error|validation|stack/);
    expect(result.message).toContain("don't recognise");
    expect(result.detail).toContain('AI_TypeValidationError');
    expect(result.kind).toBe('other');
  });

  it("explains Z.ai's plan limit using the exact message seen in a real session", () => {
    const raw =
      'Failed after 3 attempts. Last error: AI_APICallError: Usage limit reached for 5 hour. Your limit will reset at 2026-09-17 13:03:01';
    const result = plainError(new Error(raw), 'zai');
    expect(result.message).toBe(
      'Your Z.ai plan has used up its allowance for now. Z.ai says it resets at 13:03. Type /model to use a different model meanwhile.'
    );
    expect(result.kind).toBe('payment');
  });

  it('names the service in use, not always OpenRouter', () => {
    expect(plainError(new Error('401 Unauthorized'), 'zai').message).toContain("Z.ai didn't accept the key");
    expect(plainError(new Error('fetch failed'), 'ollama').message).toContain("Couldn't reach Ollama");
  });
});

describe('plain tool failures', () => {
  it('translates common file errors', () => {
    expect(plainToolFailure(new Error("ENOENT: no such file, 'x.txt'"))).toBe("couldn't find that file or folder");
    expect(plainToolFailure(new Error('EACCES: permission denied'))).toBe("the computer wouldn't allow it");
    expect(plainToolFailure(new Error('EISDIR: illegal operation on a directory, read'))).toBe('that is a folder, not a file');
    expect(plainToolFailure(new Error('The command was stopped after 2 minutes.'))).toBe('took too long');
    expect(plainToolFailure(new Error('This looks like a binary file; it cannot be read as text.'))).toBe('not a text file');
  });

  it('never shows an unrecognised technical message', () => {
    expect(plainToolFailure(new Error('EPIPE: broken pipe, write'))).toBe('something unexpected went wrong');
    expect(plainToolFailure(new Error('spawn /bin/zsh ENOEXEC'))).toBe('something unexpected went wrong');
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