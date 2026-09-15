import { describe, it, expect } from 'vitest';
import { mapOllamaTags } from '../src/providers/ollama.js';

describe('local Ollama model mapping', () => {
  it('maps the /api/tags payload into picker rows', () => {
    const models = mapOllamaTags({
      models: [
        { name: 'llama3.3:latest', model_info: { context_length: 131072 } },
        { name: 'qwen3:8b' },
      ],
    });
    expect(models).toHaveLength(2);
    expect(models[0]).toEqual({
      id: 'llama3.3:latest',
      name: 'llama3.3:latest',
      contextLength: 131072,
      promptPrice: 0,
      completionPrice: 0,
      supportedParameters: ['tools'],
      provider: 'ollama',
    });
    expect(models[1].contextLength).toBe(0);
  });

  it('skips nameless entries and tolerates junk', () => {
    expect(mapOllamaTags(null)).toEqual([]);
    expect(mapOllamaTags({})).toEqual([]);
    expect(mapOllamaTags({ models: 'nope' })).toEqual([]);
    expect(mapOllamaTags({ models: [{ size: 123 }, null] })).toEqual([]);
  });
});