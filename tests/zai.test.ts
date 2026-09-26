import { describe, it, expect } from 'vitest';
import { ZAI_MODELS, createZaiProvider, ZAI_CODING_BASE_URL } from '../src/providers/zai.js';
import { PROVIDER_ROWS } from '../src/providers/index.js';
import { isToolCapable } from '../src/models/filter.js';
import { compactPrice } from '../src/models/registry.js';

describe('Z.ai provider adapter', () => {
  it('offers the GLM coding models, all tool-capable', () => {
    expect(ZAI_MODELS.length).toBeGreaterThan(0);
    for (const model of ZAI_MODELS) {
      expect(model.provider).toBe('zai');
      expect(isToolCapable(model)).toBe(true);
      expect(model.contextLength).toBeGreaterThan(0);
    }
    expect(ZAI_MODELS.some((model) => model.id === 'glm-5.3')).toBe(true);
  });

  it('labels the flat plan as included instead of a misleading price', () => {
    for (const model of ZAI_MODELS) {
      expect(compactPrice(model.promptPrice, model.completionPrice, model.priceLabel)).toBe('included');
    }
  });

  it('builds a provider that speaks to the Z.ai endpoint', () => {
    const provider = createZaiProvider('test-key');
    expect(provider.id).toBe('zai');
    expect(provider.name).toBe('Z.ai');
    expect(typeof provider.stream).toBe('function');
  });

  it('targets the GLM Coding Plan endpoint, not the standard pay-per-token API', () => {
    expect(ZAI_CODING_BASE_URL).toBe('https://api.z.ai/api/coding/paas/v4');
  });

  it('appears in the picker provider list with the flat-plan note', () => {
    const row = PROVIDER_ROWS.find((entry) => entry.id === 'zai');
    expect(row).toBeDefined();
    expect(row?.label).toBe('Z.ai');
    expect(row?.description).toContain('$18/month flat');
    expect(PROVIDER_ROWS[0].id).toBe('openrouter');
  });
});

describe('the Flash models answer without a thinking phase (26 Sept)', () => {
  it('only the Flash models skip thinking; the big model keeps it', async () => {
    const { answersWithoutThinking } = await import('../src/providers/zai.js');
    expect(answersWithoutThinking('glm-5.3-flash')).toBe(true);
    expect(answersWithoutThinking('glm-5.3')).toBe(false);
    expect(answersWithoutThinking('glm-5.2')).toBe(false);
  });
});
