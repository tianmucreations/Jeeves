import { describe, it, expect, beforeEach } from 'vitest';
import type { ModelMessage } from 'ai';
import {
  trimCatalogue,
  estimateCost,
  idsFromList,
  isRejection,
  directModelList,
  tidyAddress,
  toModelInfo,
  modelListRequest,
  type Catalogue,
} from '../src/providers/catalogue.js';
import { markForCaching, createDirectProvider, createCustomProvider } from '../src/providers/direct.js';
import { DIRECT_SERVICES, serviceNameFor, isEstimatedCostService } from '../src/providers/direct-services.js';
import { MODELS_SNAPSHOT } from '../src/providers/models-snapshot.js';
import { prepareStepFor } from '../src/providers/step-control.js';
import { footerSegments, type FooterInfo } from '../src/components/Footer.js';
import { plainError } from '../src/agent/errors.js';
import { reportSpend, reportStepCost } from '../src/agent/spending.js';
import { getEstimatedSpend, setEstimatedSpend } from '../src/platform/config.js';
import { localDate } from '../src/state/today-spend.js';
import { PROVIDER_ROWS } from '../src/providers/index.js';
import { compactPrice } from '../src/models/registry.js';

// A slice of the real models.dev format (fields as served on 18 Sept 2026).
const modelsDev = {
  anthropic: {
    id: 'anthropic',
    models: {
      'claude-sonnet-5': {
        id: 'claude-sonnet-5',
        name: 'Claude Sonnet 5',
        tool_call: true,
        release_date: '2026-06-29',
        modalities: { input: ['text', 'image', 'pdf'], output: ['text'] },
        limit: { context: 1_000_000, output: 64_000 },
        cost: { input: 2, output: 10, cache_read: 0.2, cache_write: 2.5 },
      },
      'claude-opus-5': {
        id: 'claude-opus-5',
        name: 'Claude Opus 5',
        tool_call: true,
        release_date: '2026-07-24',
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 1_000_000 },
        cost: { input: 5, output: 25, cache_read: 0.5, cache_write: 6.25 },
      },
      'claude-old': {
        id: 'claude-old',
        name: 'Old',
        tool_call: true,
        status: 'deprecated',
        modalities: { input: ['text'], output: ['text'] },
        limit: { context: 200_000 },
        cost: { input: 1, output: 1 },
      },
    },
  },
  google: {
    id: 'google',
    models: {
      'image-maker': {
        id: 'image-maker',
        tool_call: true,
        modalities: { input: ['text'], output: ['text', 'image'] },
        limit: { context: 65_536 },
      },
      'no-tools': { id: 'no-tools', tool_call: false, modalities: { input: ['text'], output: ['text'] }, limit: { context: 1_000_000 } },
      tiny: { id: 'tiny', tool_call: true, modalities: { input: ['text'], output: ['text'] }, limit: { context: 8_192 } },
      gemma: { id: 'gemma', name: 'Gemma', tool_call: true, modalities: { input: ['text'], output: ['text'] }, limit: { context: 262_144 } },
    },
  },
  'some-reseller': { id: 'some-reseller', models: { x: { id: 'x', tool_call: true } } },
};

describe('direct connections: the model catalogue', () => {
  it('keeps only models that can use tools, answer in text, are not retired, and have room to work', () => {
    const catalogue = trimCatalogue(modelsDev);
    expect(catalogue.anthropic?.map((m) => m.id).sort()).toEqual(['claude-opus-5', 'claude-sonnet-5']);
    expect(catalogue.google?.map((m) => m.id)).toEqual(['gemma']);
    expect(Object.keys(catalogue)).toEqual(['anthropic', 'google']);
  });

  it('keeps the price list, and marks a model without one as "price not listed"', () => {
    const catalogue = trimCatalogue(modelsDev);
    const sonnet = catalogue.anthropic!.find((m) => m.id === 'claude-sonnet-5')!;
    expect(sonnet.cost).toEqual({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 });
    const sonnetRow = toModelInfo('anthropic', sonnet);
    expect(compactPrice(sonnetRow.promptPrice, sonnetRow.completionPrice, sonnetRow.priceLabel)).toBe('$2.00/$10.00 per M');
    const gemma = toModelInfo('google', catalogue.google![0]);
    expect(compactPrice(gemma.promptPrice, gemma.completionPrice, gemma.priceLabel)).toBe('price not listed');
  });

  it('ships a built-in copy with every company, and each company has its everyday model in it', () => {
    for (const service of DIRECT_SERVICES) {
      const models = MODELS_SNAPSHOT[service.id] ?? [];
      expect(models.length, service.id).toBeGreaterThan(0);
      expect(service.defaults.some((id) => models.some((m) => m.id === id)), service.id).toBe(true);
    }
  });

  it('lists what the key can use, newest first, with the everyday model on top', () => {
    const catalogue: Catalogue = trimCatalogue(modelsDev);
    const all = directModelList('anthropic', catalogue, null).map((m) => m.id);
    expect(all).toEqual(['claude-sonnet-5', 'claude-opus-5']);
    const onlyOpus = directModelList('anthropic', catalogue, new Set(['claude-opus-5', 'claude-unknown'])).map((m) => m.id);
    expect(onlyOpus).toEqual(['claude-opus-5']);
  });
});

describe('direct connections: cost estimates', () => {
  const sonnet = { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 };

  it('charges fresh input, cache reads, cache writes and output at their own rates', () => {
    // 10,000 fresh + 40,000 read from cache + 2,000 written to cache, 1,000 out:
    // 0.02 + 0.008 + 0.005 + 0.01 = $0.043
    const cost = estimateCost(sonnet, {
      inputTokens: 52_000,
      outputTokens: 1_000,
      inputTokenDetails: { noCacheTokens: 10_000, cacheReadTokens: 40_000, cacheWriteTokens: 2_000 },
    });
    expect(cost).toBeCloseTo(0.043, 10);
  });

  it('works out fresh input when the service does not split it', () => {
    expect(estimateCost(sonnet, { inputTokens: 50_000, outputTokens: 0, inputTokenDetails: { cacheReadTokens: 40_000 } })).toBeCloseTo(0.028, 10);
  });

  it('costs nothing without a price list, rather than guessing', () => {
    expect(estimateCost(undefined, { inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBe(0);
  });

  it('counts each step while the job runs, so the spending limit can stop it partway', async () => {
    const seen: number[][] = [];
    const prepare = prepareStepFor(
      async ({ stepCosts }) => {
        seen.push(stepCosts);
        return {};
      },
      () => ({}) as never,
      (step) => estimateCost(sonnet, step.usage ?? {})
    )!;
    await prepare({ stepNumber: 1, steps: [{ content: [], usage: { inputTokens: 100_000, outputTokens: 0 } }], messages: [] });
    expect(seen[0][0]).toBeCloseTo(0.2, 10);
  });

  it("keeps today's estimated spending between launches", () => {
    const now = new Date();
    setEstimatedSpend({ date: '2000-01-01', amount: 9 });
    reportSpend(0.25, true, now);
    reportSpend(0.5, true, now);
    reportSpend(1, false, now);
    expect(getEstimatedSpend()).toEqual({ date: localDate(now), amount: 0.75 });
    expect(isEstimatedCostService('anthropic')).toBe(true);
    expect(isEstimatedCostService('openrouter')).toBe(false);
    void reportStepCost;
  });
});

describe('direct connections: checking keys and model lists', () => {
  it("reads each company's model list reply", () => {
    expect([...idsFromList({ data: [{ id: 'gpt-5.5' }, { id: 'gpt-5.4' }] })]).toEqual(['gpt-5.5', 'gpt-5.4']);
    expect([...idsFromList({ models: [{ name: 'models/gemini-3.8-flash' }] })]).toEqual(['gemini-3.8-flash']);
    expect(idsFromList('nonsense').size).toBe(0);
  });

  it("recognises a refused key, including Google's 400 (measured live)", () => {
    expect(isRejection(401, '')).toBe(true);
    expect(isRejection(403, '')).toBe(true);
    expect(isRejection(400, '{"message":"API key not valid. Please pass a valid API key."}')).toBe(true);
    expect(isRejection(400, 'bad request')).toBe(false);
    expect(isRejection(500, '')).toBe(false);
  });

  it('sends the key the way each company expects', () => {
    expect(modelListRequest('anthropic', 'k').headers).toEqual({ 'x-api-key': 'k', 'anthropic-version': '2023-06-01' });
    expect(modelListRequest('google', 'k').headers).toEqual({ 'x-goog-api-key': 'k' });
    expect(modelListRequest('groq', 'k').url).toBe('https://api.groq.com/openai/v1/models');
    expect(modelListRequest('openai', 'k').headers).toEqual({ Authorization: 'Bearer k' });
  });

  it('tidies a pasted address for the compatible service', () => {
    expect(tidyAddress('api.together.xyz/v1/')).toBe('https://api.together.xyz/v1');
    expect(tidyAddress(' https://example.com/v1/chat/completions ')).toBe('https://example.com/v1');
    expect(tidyAddress('http://localhost:1234/v1/models')).toBe('http://localhost:1234/v1');
    expect(serviceNameFor('https://api.together.xyz/v1')).toBe('together.xyz');
  });
});

describe('direct connections: Anthropic prompt caching', () => {
  const messages: ModelMessage[] = [
    { role: 'user', content: 'one', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } } } },
    { role: 'assistant', content: 'two', providerOptions: { anthropic: { cacheControl: { type: 'ephemeral' } }, other: { keep: true } } },
    { role: 'user', content: 'three' },
    { role: 'assistant', content: 'four' },
  ];

  it('marks only the last two messages, so the four-mark limit is never passed', () => {
    const marked = markForCaching(messages);
    const hasMark = (message: ModelMessage) => Boolean((message.providerOptions as { anthropic?: { cacheControl?: unknown } } | undefined)?.anthropic?.cacheControl);
    expect(marked.map(hasMark)).toEqual([false, false, true, true]);
    expect(marked[1].providerOptions).toEqual({ other: { keep: true } });
  });

  it('never changes the stored conversation', () => {
    const before = JSON.stringify(messages);
    markForCaching(messages);
    expect(JSON.stringify(messages)).toBe(before);
  });
});

describe('direct connections: the rest of Jeeves', () => {
  it('lists every company and the compatible service in /model', () => {
    const ids = PROVIDER_ROWS.map((row) => row.id);
    for (const service of DIRECT_SERVICES) expect(ids).toContain(service.id);
    expect(ids).toContain('custom');
    expect(PROVIDER_ROWS.find((row) => row.id === 'anthropic')?.description).not.toContain('through OpenRouter');
  });

  it('builds a connection for each company and for a compatible service', () => {
    for (const service of DIRECT_SERVICES) {
      const provider = createDirectProvider(service.id, 'test-key');
      expect(provider.id).toBe(service.id);
      expect(provider.name).toBe(service.label);
    }
    expect(createCustomProvider('https://api.together.xyz/v1', 'k').name).toBe('together.xyz');
  });

  const base: FooterInfo = { providerId: 'anthropic', allowance: 3, tidying: false, todaySpend: 0.12, creditRemaining: null, creditIsAccount: false, planResetAt: null };

  it('shows an estimated spend for a direct connection, and no balance it cannot know', () => {
    expect(footerSegments(base).map((s) => s.text)).toEqual(['today ~$0.12 of $3.00']);
    expect(footerSegments({ ...base, busyNote: 'backing up…' }).map((s) => s.text)).toEqual(['backing up…', 'today ~$0.12 of $3.00']);
    expect(footerSegments({ ...base, todaySpend: 3 })[0].color).toBe('red');
  });

  it('says plainly when a compatible service cannot be costed', () => {
    expect(footerSegments({ ...base, providerId: 'custom' }).map((s) => s.text)).toEqual(['cost not tracked']);
  });

  it("names the company in plain-English errors, including each one's own wording", () => {
    expect(plainError(Object.assign(new Error('invalid x-api-key'), { statusCode: 401 }), 'anthropic').message).toBe(
      "Anthropic didn't accept the key - type /keys to check or replace it."
    );
    expect(plainError(new Error('API key not valid. Please pass a valid API key.'), 'google').kind).toBe('auth');
    expect(plainError(new Error('Incorrect API key provided: sk-abc'), 'openai').kind).toBe('auth');
    const credit = plainError(new Error('Your credit balance is too low to access the Anthropic API.'), 'anthropic');
    expect(credit.kind).toBe('payment');
    expect(credit.message).toBe('Anthropic credit ran out - add credit on the Anthropic website, then ask again.');
    expect(plainError(new Error('No Mistral key yet. Add one with /keys.'), 'mistral').kind).toBe('auth');
    expect(plainError(new Error('402 Payment Required')).message).toContain('openrouter.ai/credits');
  });
});

beforeEach(() => {
  setEstimatedSpend({ date: '2000-01-01', amount: 0 });
});
