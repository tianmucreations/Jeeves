import { describe, it, expect, vi, afterEach } from 'vitest';
import { session } from '../src/state/session.js';
import { rememberModels, toModelInfo } from '../src/providers/catalogue.js';
import { noAutoNote, hasAuto, workerModel, expertModel, topModel, autoRowFor, workingModelId, topModelName, readableModelName } from '../src/agent/auto.js';
import { reviewers } from '../src/agent/review.js';
import { readingModels } from '../src/tools/web/research.js';

const openai = ['gpt-5.6-luna', 'gpt-5.4-mini', 'gpt-5.6-terra', 'gpt-5.5', 'gpt-5.6-sol'].map((id) =>
  toModelInfo('openai', { id, name: id.toUpperCase(), released: '2026-07-09', context: 1_000_000, cost: { input: 1, output: 1 } })
);

afterEach(() => {
  session.providerId = 'openrouter';
  session.model = 'jeeves/auto';
  vi.unstubAllGlobals();
});

describe('Auto on a direct connection (OpenAI)', () => {
  it('exists for OpenRouter, OpenAI and Google only - the pairs measured so far', () => {
    expect(hasAuto('openai')).toBe(true);
    expect(hasAuto('openrouter')).toBe(true);
    expect(hasAuto('google')).toBe(true);
    for (const id of ['anthropic', 'xai', 'groq', 'mistral', 'zai', 'ollama', 'custom']) expect(hasAuto(id), id).toBe(false);
  });

  it("uses OpenAI's own models: GPT-5.6 Luna working, Terra as expert, Sol as the strongest", () => {
    rememberModels(openai);
    session.providerId = 'openai';
    expect(workerModel()).toBe('gpt-5.6-luna');
    expect(expertModel()).toBe('gpt-5.6-terra');
    expect(topModel()).toBe('gpt-5.6-sol');
    expect(workingModelId('jeeves/auto')).toBe('gpt-5.6-luna');
    expect(reviewers()).toEqual(['gpt-5.6-terra', 'gpt-5.5']);
    expect(topModelName()).toBe('GPT-5.6-SOL');
  });

  it('moves to the replacement when a model is gone from the list the key can use', () => {
    session.providerId = 'openai';
    const withoutLuna = openai.filter((m) => m.id !== 'gpt-5.6-luna');
    expect(autoRowFor('openai', withoutLuna)?.id).toBe('jeeves/auto');
    expect(autoRowFor('openai', withoutLuna)?.promptPrice).toBe(withoutLuna.find((m) => m.id === 'gpt-5.4-mini')!.promptPrice);
    expect(autoRowFor('openai', [])).toBeNull();
  });

  it('puts an Auto row only in the lists of services that have Auto', () => {
    expect(autoRowFor('openai', openai)).toMatchObject({ id: 'jeeves/auto', name: 'Auto', provider: 'openai', priceLabel: 'cheap, expert when needed' });
    expect(autoRowFor('anthropic', openai)).toBeNull();
    expect(autoRowFor('openrouter', openai)).toBeNull();
  });

  it('web research still uses OpenRouter models when OpenAI is the service', () => {
    rememberModels(openai);
    session.providerId = 'openai';
    expect(readingModels().every((id) => id.includes('/'))).toBe(true);
  });

  it('writes readable names when the catalogue has not loaded', () => {
    expect(readableModelName('anthropic/claude-opus-5')).toBe('Claude Opus 5');
    expect(readableModelName('gpt-5.6-sol')).toBe('GPT 5.6 Sol');
  });
});

describe('a plain line where Auto is not offered', () => {
  it('names the services that have Auto, and says nothing where Auto exists', () => {
    expect(noAutoNote('anthropic', 'Anthropic')).toBe("Auto isn't available with Anthropic yet - choose OpenRouter, OpenAI or Google for Auto.");
    expect(noAutoNote('ollama', 'Ollama')).toContain('with Ollama yet');
    expect(noAutoNote('openai', 'OpenAI')).toBeNull();
    expect(noAutoNote('google', 'Google')).toBeNull();
    expect(noAutoNote('openrouter', 'OpenRouter')).toBeNull();
  });
});
