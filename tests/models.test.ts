import { describe, it, expect, vi, afterEach } from 'vitest';
import { normalizeModels, loadModels, compactContext, compactPrice, isFastModel, resolveCurated, cleanModelName } from '../src/models/registry.js';
import { isToolCapable } from '../src/models/filter.js';
import { setModelCache } from '../src/platform/config.js';

const SAMPLE = {
  data: [
    {
      id: 'z-ai/glm-5.3',
      name: 'GLM 5.3 (preview)',
      context_length: 1310720,
      pricing: { prompt: '0.0000011', completion: '0.0000045' },
      supported_parameters: ['tools', 'reasoning'],
    },
    {
      id: 'openai/gpt-4o-mini',
      name: 'GPT-4o mini',
      context_length: 128000,
      pricing: { prompt: '0.00000015', completion: '0.0000006' },
      supported_parameters: ['tools', 'tool_choice'],
    },
    {
      id: 'meta-llama/llama-3.3-70b-instruct',
      name: 'Llama 3.3 70B Instruct',
      context_length: 131072,
      pricing: { prompt: '0.00000012', completion: '0.0000003' },
      supported_parameters: [],
    },
  ],
};

describe('model normalization', () => {
  it('maps the OpenRouter payload into model records', () => {
    const models = normalizeModels(SAMPLE);
    expect(models).toHaveLength(3);
    expect(models[0]).toEqual({
      id: 'z-ai/glm-5.3',
      name: 'GLM 5.3 (preview)',
      contextLength: 1310720,
      promptPrice: 0.0000011,
      completionPrice: 0.0000045,
      supportedParameters: ['tools', 'reasoning'],
      provider: 'z-ai',
    });
  });

  it('skips entries without an id and tolerates missing fields', () => {
    const models = normalizeModels({ data: [{ name: 'broken' }, { id: 'x/y' }] });
    expect(models).toHaveLength(1);
    expect(models[0].contextLength).toBe(0);
    expect(models[0].promptPrice).toBe(0);
    expect(models[0].supportedParameters).toEqual([]);
  });

  it('returns nothing for a malformed body', () => {
    expect(normalizeModels(null)).toEqual([]);
    expect(normalizeModels({})).toEqual([]);
    expect(normalizeModels({ data: 'nope' })).toEqual([]);
  });
});

describe('tool-capability filter', () => {
  const models = normalizeModels(SAMPLE);
  it('accepts models that report tools or tool_choice', () => {
    expect(isToolCapable(models[0])).toBe(true);
    expect(isToolCapable(models[1])).toBe(true);
    expect(isToolCapable(models[2])).toBe(false);
  });
});

describe('row formatting helpers', () => {
  it('compacts context lengths', () => {
    expect(compactContext(1310720)).toBe('1.3M');
    expect(compactContext(128000)).toBe('128k');
    expect(compactContext(512)).toBe('512');
  });

  it('compacts prices per million tokens', () => {
    expect(compactPrice(0, 0)).toBe('free');
    expect(compactPrice(0.0000011, 0.0000045)).toBe('$1.10/$4.50 per M');
    expect(compactPrice(-1, -1)).toBe('varies');
  });

  it('flags fast-sounding models', () => {
    const models = normalizeModels(SAMPLE);
    expect(isFastModel(models[1])).toBe(true);
    expect(isFastModel(models[2])).toBe(false);
  });
});

describe('curated shortlist', () => {
  const models = normalizeModels(SAMPLE);

  it('resolves curated rows to the first candidate present in the catalog', () => {
    // The sample catalog contains z-ai/glm-5.3, so one curated row resolves - and Auto
    // heads the list, because GLM 5.3 is one of its replacement worker models.
    const picks = resolveCurated(models);
    expect(picks.map((pick) => pick.model.id)).toEqual(['jeeves/auto', 'z-ai/glm-5.3']);
    expect(picks[1].blurb).toBe('best value');

    const extended = normalizeModels({
      data: [
        ...SAMPLE.data,
        { id: 'z-ai/glm-5.3', name: 'Z.ai: GLM 5.3', context_length: 1310720, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
        { id: 'qwen/qwen3-coder-flash', name: 'Qwen: Qwen3 Coder Flash', context_length: 1000000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] },
      ],
    });
    const resolved = resolveCurated(extended);
    expect(resolved.map((pick) => pick.model.id)).toEqual(['jeeves/auto', 'z-ai/glm-5.3', 'qwen/qwen3-coder-flash']);
    expect(resolved[1].blurb).toBe('best value');
    expect(resolved[2].blurb).toBe('good for code');
  });

  it('strips provider prefixes from display names', () => {
    expect(cleanModelName('Z.ai: GLM 5.3')).toBe('GLM 5.3');
    expect(cleanModelName('Anthropic: Claude Opus 5')).toBe('Claude Opus 5');
    expect(cleanModelName('Plain Name')).toBe('Plain Name');
  });
});

describe('registry cache fallback', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('falls back to the saved cache when the network fails', async () => {
    const previous = setModelCache;
    setModelCache(SAMPLE, Date.now() - 8 * 24 * 60 * 60 * 1000);
    vi.stubGlobal('fetch', vi.fn(() => {
      throw new Error('offline');
    }));
    const { models, error } = await loadModels();
    expect(models).toHaveLength(3);
    expect(models[0].id).toBe('z-ai/glm-5.3');
    expect(error).toContain('Could not refresh');
    void previous;
  });
});
describe('free models', () => {
  it('are free OpenRouter models only - not plan models marked included, not local ones', async () => {
    const { isFreeModel } = await import('../src/models/registry.js');
    const base = { id: 'x/y:free', name: 'Y', contextLength: 1, promptPrice: 0, completionPrice: 0, supportedParameters: ['tools'], provider: 'x' };
    expect(isFreeModel(base)).toBe(true);
    expect(isFreeModel({ ...base, promptPrice: 0.0000001 })).toBe(false);
    expect(isFreeModel({ ...base, provider: 'zai', priceLabel: 'included' })).toBe(false);
    expect(isFreeModel({ ...base, provider: 'ollama' })).toBe(false);
  });
});
