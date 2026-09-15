import { getModelCache, setModelCache } from '../platform/config.js';

export interface ModelInfo {
  id: string;
  name: string;
  contextLength: number;
  promptPrice: number;
  completionPrice: number;
  supportedParameters: string[];
  provider: string;
}

const MODELS_URL = 'https://openrouter.ai/api/v1/models';
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function toNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

// Maps the public OpenRouter models payload into the picker's model records.
export function normalizeModels(body: unknown): ModelInfo[] {
  if (typeof body !== 'object' || body === null) return [];
  const data = (body as { data?: unknown }).data;
  if (!Array.isArray(data)) return [];
  const models: ModelInfo[] = [];
  for (const raw of data) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const id = typeof entry.id === 'string' ? entry.id : '';
    if (!id) continue;
    const pricing = (typeof entry.pricing === 'object' && entry.pricing !== null ? entry.pricing : {}) as Record<string, unknown>;
    models.push({
      id,
      name: typeof entry.name === 'string' && entry.name.length > 0 ? entry.name : id,
      contextLength: typeof entry.context_length === 'number' ? entry.context_length : 0,
      promptPrice: toNumber(pricing.prompt),
      completionPrice: toNumber(pricing.completion),
      supportedParameters: Array.isArray(entry.supported_parameters)
        ? entry.supported_parameters.filter((param): param is string => typeof param === 'string')
        : [],
      provider: id.includes('/') ? id.slice(0, id.indexOf('/')) : 'openrouter',
    });
  }
  return models;
}

// Loads the model list: fresh weekly fetch, cached in the config directory,
// with graceful fallback to the cache when the network fails.
export async function loadModels(): Promise<{ models: ModelInfo[]; error: string }> {
  const cache = getModelCache();
  if (cache && Date.now() - cache.fetchedAt < WEEK_MS) {
    return { models: normalizeModels(cache.raw), error: '' };
  }
  try {
    const response = await fetch(MODELS_URL);
    if (!response.ok) throw new Error(`the models list is unavailable (${response.status})`);
    const body = await response.json();
    setModelCache(body, Date.now());
    return { models: normalizeModels(body), error: '' };
  } catch (error) {
    if (cache) {
      return { models: normalizeModels(cache.raw), error: 'Could not refresh the model list - showing the saved copy.' };
    }
    return { models: [], error: `Could not load the model list: ${error instanceof Error ? error.message : String(error)}` };
  }
}

export function compactContext(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`;
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}k`;
  return `${tokens}`;
}

export interface CuratedModel {
  ids: string[];
  blurb: string;
}

// A short, human-first shortlist. Each entry lists candidate ids so the row
// survives catalog drift; the first id found in the catalog wins.
export const CURATED_MODELS: CuratedModel[] = [
  { ids: ['z-ai/glm-5.3', 'z-ai/glm-5.3-flash', 'z-ai/glm-5.2'], blurb: 'best value' },
  { ids: ['deepseek/deepseek-v4-flash-0731', 'deepseek/deepseek-v4-flash', 'deepseek/deepseek-v3.2'], blurb: 'cheapest' },
  { ids: ['anthropic/claude-opus-5', 'anthropic/claude-opus-4.8', 'anthropic/claude-sonnet-5'], blurb: 'best quality' },
  { ids: ['openai/gpt-5.5', 'openai/gpt-5.4', 'openai/gpt-5.1'], blurb: 'strong all-rounder' },
  { ids: ['google/gemini-3.1-pro-preview', 'google/gemini-3-pro-preview', 'google/gemini-2.5-pro'], blurb: 'huge memory' },
  { ids: ['qwen/qwen3-coder-plus', 'qwen/qwen3-coder', 'qwen/qwen3-coder-flash'], blurb: 'good for code' },
];

export interface CuratedPick {
  model: ModelInfo;
  blurb: string;
}

export function resolveCurated(models: ModelInfo[]): CuratedPick[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  const picks: CuratedPick[] = [];
  for (const entry of CURATED_MODELS) {
    for (const id of entry.ids) {
      const model = byId.get(id);
      if (model) {
        picks.push({ model, blurb: entry.blurb });
        break;
      }
    }
  }
  return picks;
}

// Strips the "Provider: " prefix OpenRouter puts in display names.
export function cleanModelName(name: string): string {
  const stripped = name.replace(/^[A-Za-z][A-Za-z0-9 .-]*: /, '');
  return stripped.length > 0 ? stripped : name;
}

export function compactPrice(prompt: number, completion: number): string {
  if (prompt === 0 && completion === 0) return 'free';
  // OpenRouter marks router models with negative sentinels; their price varies by routed model.
  if (prompt < 0 || completion < 0) return 'varies';
  const perMillion = (value: number) => `$${(value * 1_000_000).toFixed(2)}`;
  return `${perMillion(prompt)}/${perMillion(completion)} per M`;
}

// Assumption: OpenRouter's models endpoint carries no speed data, so the indicator uses
// naming conventions (flash/turbo/mini/air/haiku/nano/instant) as a rough hint.
export function isFastModel(model: ModelInfo): boolean {
  const name = `${model.name} ${model.id}`.toLowerCase();
  return ['flash', 'turbo', 'mini', 'air', 'haiku', 'nano', 'instant'].some((hint) => name.includes(hint));
}