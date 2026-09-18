import type { ModelInfo } from '../models/registry.js';
import { DIRECT_SERVICES, directService, type DirectServiceId } from './direct-services.js';
import { getDirectCatalogue, setDirectCatalogue } from '../platform/config.js';
import { MODELS_SNAPSHOT } from './models-snapshot.js';

// Model lists and prices for the direct connections.
// - What each model can do and costs comes from models.dev (MIT licence), the open
//   catalogue OpenCode uses; refreshed daily, saved between launches, and a copy is
//   built into Jeeves so a first launch without internet still has prices.
// - Which models a key can actually use comes live from the company itself, so a
//   retired model or one the key has no access to is never offered.

export const MODELS_DEV_URL = 'https://models.dev/api.json';
const DAY_MS = 24 * 60 * 60 * 1000;
// Jeeves's rulebook and tools alone take several thousand tokens; smaller models can't work.
const MIN_CONTEXT = 32_000;

// Dollars per million tokens, as models.dev lists them.
export interface PriceList {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface CatalogueModel {
  id: string;
  name: string;
  released: string;
  context: number;
  cost?: PriceList;
}

// Company id -> its usable models: tools, text in and out, not retired, room to work.
export type Catalogue = Partial<Record<DirectServiceId, CatalogueModel[]>>;

function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

// Keeps only what Jeeves needs from the full models.dev file (about 5 MB, 200+ services).
export function trimCatalogue(body: unknown): Catalogue {
  const out: Catalogue = {};
  if (typeof body !== 'object' || body === null) return out;
  for (const service of DIRECT_SERVICES) {
    const entry = (body as Record<string, unknown>)[service.id] as { models?: Record<string, unknown> } | undefined;
    if (!entry || typeof entry.models !== 'object' || entry.models === null) continue;
    const models: CatalogueModel[] = [];
    for (const raw of Object.values(entry.models)) {
      if (typeof raw !== 'object' || raw === null) continue;
      const m = raw as Record<string, any>;
      const output: unknown = m.modalities?.output;
      const input: unknown = m.modalities?.input;
      const context = num(m.limit?.context) ?? 0;
      if (typeof m.id !== 'string' || m.tool_call !== true || m.status === 'deprecated') continue;
      if (!Array.isArray(output) || output.length !== 1 || output[0] !== 'text') continue;
      if (!Array.isArray(input) || !input.includes('text')) continue;
      if (context < MIN_CONTEXT) continue;
      const inputPrice = num(m.cost?.input);
      const outputPrice = num(m.cost?.output);
      models.push({
        id: m.id,
        name: typeof m.name === 'string' && m.name ? m.name : m.id,
        released: typeof m.release_date === 'string' ? m.release_date : '',
        context,
        ...(inputPrice !== undefined && outputPrice !== undefined
          ? {
              cost: {
                input: inputPrice,
                output: outputPrice,
                ...(num(m.cost?.cache_read) !== undefined ? { cacheRead: num(m.cost.cache_read) } : {}),
                ...(num(m.cost?.cache_write) !== undefined ? { cacheWrite: num(m.cost.cache_write) } : {}),
              },
            }
          : {}),
      });
    }
    out[service.id] = models;
  }
  return out;
}

let loaded: Catalogue | null = null;

// The catalogue: today's saved copy, else a fresh download, else the last saved copy,
// else the copy built into Jeeves. Never fails.
export async function loadCatalogue(now = Date.now()): Promise<Catalogue> {
  if (loaded) return loaded;
  const saved = getDirectCatalogue();
  if (saved && now - saved.fetchedAt < DAY_MS) {
    loaded = saved.catalogue as Catalogue;
    return loaded;
  }
  try {
    const response = await fetch(MODELS_DEV_URL, { signal: AbortSignal.timeout(20_000) });
    if (!response.ok) throw new Error(`models.dev returned ${response.status}`);
    const trimmed = trimCatalogue(await response.json());
    if (Object.keys(trimmed).length === 0) throw new Error('models.dev returned no models');
    setDirectCatalogue(trimmed, now);
    loaded = trimmed;
  } catch {
    loaded = (saved?.catalogue as Catalogue | undefined) ?? MODELS_SNAPSHOT;
  }
  return loaded;
}

// For tests.
export function resetCatalogue(): void {
  loaded = null;
}

// The price list of one model, once the catalogue has loaded (for cost estimates).
export function priceOf(serviceId: string, modelId: string): PriceList | undefined {
  const service = directService(serviceId);
  if (!service) return undefined;
  const models = (loaded ?? MODELS_SNAPSHOT)[service.id] ?? [];
  return models.find((model) => model.id === modelId)?.cost;
}

// Tokens a step used, as the AI SDK reports them.
export interface StepUsage {
  inputTokens?: number;
  outputTokens?: number;
  inputTokenDetails?: { noCacheTokens?: number; cacheReadTokens?: number; cacheWriteTokens?: number };
}

// What a step cost by the company's price list, in dollars. An estimate: a model with
// dearer rates above some length (models.dev "tiers") is charged at its base rate.
export function estimateCost(price: PriceList | undefined, usage: StepUsage): number {
  if (!price) return 0;
  const input = usage.inputTokens ?? 0;
  const cacheRead = usage.inputTokenDetails?.cacheReadTokens ?? 0;
  const cacheWrite = usage.inputTokenDetails?.cacheWriteTokens ?? 0;
  const fresh = usage.inputTokenDetails?.noCacheTokens ?? Math.max(0, input - cacheRead - cacheWrite);
  const dollars =
    fresh * price.input +
    cacheRead * (price.cacheRead ?? price.input) +
    cacheWrite * (price.cacheWrite ?? price.input) +
    (usage.outputTokens ?? 0) * price.output;
  return dollars / 1_000_000;
}

export function toModelInfo(serviceId: string, model: CatalogueModel): ModelInfo {
  return {
    id: model.id,
    name: model.name,
    contextLength: model.context,
    // Per token, the unit the picker's price column uses for OpenRouter.
    promptPrice: model.cost ? model.cost.input / 1_000_000 : 0,
    completionPrice: model.cost ? model.cost.output / 1_000_000 : 0,
    supportedParameters: ['tools'],
    provider: serviceId,
    ...(model.cost ? {} : { priceLabel: 'price not listed' }),
  };
}

// The outcome of asking a company which models a key can use.
export type KeyCheck = { ok: true; ids: Set<string> } | { ok: false; reason: 'rejected' | 'unreachable' };

interface ListRequest {
  url: string;
  headers: Record<string, string>;
}

// Each company's own model list, which also proves the key works. Free to call.
export function modelListRequest(serviceId: DirectServiceId, key: string): ListRequest {
  const bearer = { Authorization: `Bearer ${key}` };
  switch (serviceId) {
    case 'anthropic':
      return { url: 'https://api.anthropic.com/v1/models?limit=1000', headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' } };
    case 'openai':
      return { url: 'https://api.openai.com/v1/models', headers: bearer };
    case 'google':
      return { url: 'https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', headers: { 'x-goog-api-key': key } };
    case 'xai':
      return { url: 'https://api.x.ai/v1/models', headers: bearer };
    case 'mistral':
      return { url: 'https://api.mistral.ai/v1/models', headers: bearer };
    case 'groq':
      return { url: 'https://api.groq.com/openai/v1/models', headers: bearer };
  }
}

// Model ids from a list reply: {data:[{id}]} for most, {models:[{name:"models/x"}]} for Google.
export function idsFromList(body: unknown): Set<string> {
  const ids = new Set<string>();
  if (typeof body !== 'object' || body === null) return ids;
  const record = body as { data?: unknown; models?: unknown };
  for (const item of Array.isArray(record.data) ? record.data : []) {
    const id = (item as { id?: unknown })?.id;
    if (typeof id === 'string') ids.add(id);
  }
  for (const item of Array.isArray(record.models) ? record.models : []) {
    const name = (item as { name?: unknown })?.name;
    if (typeof name === 'string') ids.add(name.replace(/^models\//, ''));
  }
  return ids;
}

// A refused key: 401/403 from most; Google says 400 "API key not valid" (measured 18 Sept).
export function isRejection(status: number, text: string): boolean {
  return status === 401 || status === 403 || (status === 400 && /api key/i.test(text));
}

export async function checkKey(serviceId: DirectServiceId, key: string): Promise<KeyCheck> {
  const request = modelListRequest(serviceId, key);
  try {
    const response = await fetch(request.url, { headers: request.headers, signal: AbortSignal.timeout(15_000) });
    const text = await response.text();
    if (isRejection(response.status, text)) return { ok: false, reason: 'rejected' };
    if (!response.ok) return { ok: false, reason: 'unreachable' };
    return { ok: true, ids: idsFromList(JSON.parse(text)) };
  } catch {
    return { ok: false, reason: 'unreachable' };
  }
}

// The picker's list for one company: newest first, its everyday model at the top.
// Limited to what the key can use when the company answered; the whole catalogue
// list otherwise (a model the key can't use then fails with a plain message).
export function directModelList(serviceId: DirectServiceId, catalogue: Catalogue, available: Set<string> | null): ModelInfo[] {
  const service = directService(serviceId);
  const all = catalogue[serviceId] ?? [];
  const usable = available && available.size > 0 ? all.filter((model) => available.has(model.id)) : all;
  const sorted = [...usable].sort((a, b) => b.released.localeCompare(a.released));
  const everyday = service?.defaults.find((id) => sorted.some((model) => model.id === id));
  const ordered = everyday ? [sorted.find((model) => model.id === everyday)!, ...sorted.filter((model) => model.id !== everyday)] : sorted;
  return ordered.map((model) => toModelInfo(serviceId, model));
}

const liveLists = new Map<string, Set<string>>();

// Loads one company's models for the picker, asking the company which the key can use
// (remembered for this session).
export async function loadDirectModels(serviceId: DirectServiceId, key: string): Promise<ModelInfo[]> {
  const catalogue = await loadCatalogue();
  let available = liveLists.get(serviceId) ?? null;
  if (!available) {
    const check = await checkKey(serviceId, key);
    if (check.ok) {
      available = check.ids;
      liveLists.set(serviceId, available);
    }
  }
  const models = directModelList(serviceId, catalogue, available);
  rememberModels(models);
  return models;
}

// Forget a company's live list when its key changes.
export function forgetLiveList(serviceId: string): void {
  liveLists.delete(serviceId);
}

// The company's everyday model, for when a key is first added.
export async function everydayModel(serviceId: DirectServiceId, key: string): Promise<string | null> {
  const models = await loadDirectModels(serviceId, key);
  return models[0]?.id ?? directService(serviceId)?.defaults[0] ?? null;
}

// Models seen this session from direct and compatible services, so the rest of Jeeves
// can look up a model's memory size without knowing where it came from.
const seen = new Map<string, ModelInfo>();

export function rememberModels(models: ModelInfo[]): void {
  for (const model of models) seen.set(`${model.provider}:${model.id}`, model);
}

export function findSeenModel(serviceId: string, modelId: string): ModelInfo | undefined {
  return seen.get(`${serviceId}:${modelId}`);
}

// The "any compatible service": the address as pasted, tidied - https:// added when
// missing, and a pasted request address (…/chat/completions) cut back to its base.
export function tidyAddress(raw: string): string {
  let address = raw.trim().replace(/\/+$/, '');
  if (!/^https?:\/\//i.test(address)) address = `https://${address}`;
  return address.replace(/\/chat\/completions$/i, '').replace(/\/models$/i, '');
}

// Asks a compatible service for its models. Tries the address as given, then with
// /v1 added (most services live there). Returns the working address and its models,
// and whether that proved the key: some services (OpenRouter, measured 18 Sept) show
// their model list to anyone, so a wrong key would pass unnoticed.
export async function checkCustomService(
  raw: string,
  key: string
): Promise<{ ok: true; baseURL: string; models: ModelInfo[]; keyChecked: boolean } | { ok: false; reason: 'rejected' | 'unreachable' }> {
  const base = tidyAddress(raw);
  const candidates = /\/v\d+$/.test(base) ? [base] : [base, `${base}/v1`];
  let rejected = false;
  for (const baseURL of candidates) {
    try {
      const response = await fetch(`${baseURL}/models`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(15_000),
      });
      const text = await response.text();
      if (isRejection(response.status, text)) {
        rejected = true;
        continue;
      }
      if (!response.ok) continue;
      const ids = [...idsFromList(JSON.parse(text))].sort();
      if (ids.length === 0) continue;
      const models = ids.map((id) => customModelInfo(id));
      rememberModels(models);
      const open = await fetch(`${baseURL}/models`, { signal: AbortSignal.timeout(15_000) }).then(
        (reply) => reply.ok,
        () => false
      );
      return { ok: true, baseURL, models, keyChecked: !open };
    } catch {
      // Try the next form of the address.
    }
  }
  return { ok: false, reason: rejected ? 'rejected' : 'unreachable' };
}

// A compatible service says nothing about prices or tools. Assumption: it can use
// tools (a model that can't will say so when asked to do a task).
export function customModelInfo(id: string): ModelInfo {
  return {
    id,
    name: id,
    contextLength: 0,
    promptPrice: 0,
    completionPrice: 0,
    supportedParameters: ['tools'],
    provider: 'custom',
    priceLabel: 'price not listed',
  };
}
