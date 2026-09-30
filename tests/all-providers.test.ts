import { describe, it, expect } from 'vitest';
import { trimCatalogue, compatibleProviders, modelListRequest, directModelList } from '../src/providers/catalogue.js';
import { compatibleServices, directService, isDirectService, registerCompatible } from '../src/providers/direct-services.js';
import { modelFactory } from '../src/providers/direct.js';

const model = { id: 'm1', name: 'M One', tool_call: true, modalities: { input: ['text'], output: ['text'] }, limit: { context: 128000 }, release_date: '2026-01-01', cost: { input: 1, output: 2 } };
const body = {
  deepseek: { npm: '@ai-sdk/openai-compatible', api: 'https://api.deepseek.com', name: 'DeepSeek', doc: 'https://api-docs.deepseek.com/x', models: { m1: model } },
  databricks: { npm: '@ai-sdk/openai-compatible', api: 'https://${DATABRICKS_HOST}/v1', name: 'Databricks', models: { m1: model } },
  azure: { npm: '@ai-sdk/azure', api: 'https://x', name: 'Azure', models: { m1: model } },
  zai: { npm: '@ai-sdk/openai-compatible', api: 'https://api.z.ai', name: 'Z.ai', models: { m1: model } },
};

describe('every catalogue provider (OpenCode-style full list)', () => {
  it('lists only compatible providers with a fixed address, never the reserved ones', () => {
    expect(compatibleProviders(body).map((p) => p.id)).toEqual(['deepseek', 'zai']);
    trimCatalogue(body);
    expect(compatibleServices().map((s) => s.id)).toEqual(['deepseek']);
    expect(isDirectService('deepseek')).toBe(true);
    expect(isDirectService('zai')).toBe(false);
  });
  it('gives them models, a key check address, and a working model factory', () => {
    const catalogue = trimCatalogue(body);
    expect(directModelList('deepseek', catalogue, null).map((m) => m.id)).toEqual(['m1']);
    expect(modelListRequest('deepseek', 'k').url).toBe('https://api.deepseek.com/models');
    expect(directService('deepseek')?.keyPage).toBe('api-docs.deepseek.com/x');
    expect(modelFactory('deepseek', 'k')('m1').modelId).toBe('m1');
    registerCompatible([]);
  });
});

import { loadCatalogue, resetCatalogue } from '../src/providers/catalogue.js';

describe('a failed first download is tried again later', () => {
  it('does not stay stuck on the older copy for good', async () => {
    resetCatalogue();
    const realFetch = globalThis.fetch;
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      throw new Error('offline');
    }) as typeof fetch;
    try {
      const start = 1_000_000;
      await loadCatalogue(start);
      expect(calls).toBe(1);
      await loadCatalogue(start + 10_000); // too soon: no second try
      expect(calls).toBe(1);
      await loadCatalogue(start + 61_000); // a minute later: tries again
      expect(calls).toBe(2);
    } finally {
      globalThis.fetch = realFetch;
      resetCatalogue();
    }
  });
});

import { PROVIDERS_SNAPSHOT } from '../src/providers/providers-snapshot.js';
import { registerSavedProviders } from '../src/providers/catalogue.js';

describe('the built-in list of other AI companies (OpenCode ships a copy too)', () => {
  it('is never empty, even with no download and nothing saved', () => {
    registerCompatible([]);
    expect(compatibleServices()).toHaveLength(0);
    registerSavedProviders();
    expect(PROVIDERS_SNAPSHOT.length).toBeGreaterThan(100);
    expect(compatibleServices().length).toBeGreaterThan(100);
    expect(compatibleServices().every((s) => s.baseURL?.match(/^https?:\/\//))).toBe(true);
    registerCompatible([]);
  });
});
