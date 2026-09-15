import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { keyLooksValid, describeKeySource } from '../src/commands/keys.js';
import { getKey, setKey, deleteKey, listProviders } from '../src/keys/store.js';
import { getDefaultModel, setDefaultModel, getDefaultProvider, setDefaultProvider, getVerbosePreference, setVerbosePreference } from '../src/platform/config.js';

describe('key validation', () => {
  it('accepts OpenRouter keys and rejects anything else', () => {
    expect(keyLooksValid('sk-or-v1-1234567890abcdef', 'openrouter')).toBe(true);
    expect(keyLooksValid('short', 'openrouter')).toBe(false);
    expect(keyLooksValid('sk-ant-not-openrouter', 'openrouter')).toBe(false);
  });

  it('accepts any sufficiently long key for other providers', () => {
    expect(keyLooksValid('sk-ant-1234567890abcdef', 'anthropic')).toBe(true);
    expect(keyLooksValid('short', 'anthropic')).toBe(false);
  });

  it('describes the key source in plain English', () => {
    expect(describeKeySource('keychain')).toContain('keychain');
    expect(describeKeySource('env')).toContain('.env');
    expect(describeKeySource(null)).toBe('no key');
  });
});

describe('keychain store escape hatch', () => {
  beforeEach(() => {
    process.env.JEEVES_SKIP_KEYCHAIN = '1';
  });
  afterEach(() => {
    delete process.env.JEEVES_SKIP_KEYCHAIN;
  });

  it('never touches the real credential store when disabled', async () => {
    expect(await getKey('openrouter')).toBeNull();
    expect(await setKey('openrouter', 'x'.repeat(30))).toBe(false);
    expect(await deleteKey('openrouter')).toBe(false);
    expect(await listProviders()).toEqual([]);
  });
});

describe('preference round-trips', () => {
  afterEach(() => {
    setDefaultModel('z-ai/glm-5.3');
    setDefaultProvider('openrouter');
    setVerbosePreference(false);
  });

  it('persists the default model, provider, and verbose flag', () => {
    setDefaultModel('openai/gpt-5.5');
    setDefaultProvider('openrouter');
    setVerbosePreference(true);
    expect(getDefaultModel()).toBe('openai/gpt-5.5');
    expect(getDefaultProvider()).toBe('openrouter');
    expect(getVerbosePreference()).toBe(true);
  });
});