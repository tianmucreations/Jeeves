import type { Provider } from './types.js';
import { createOpenRouterProvider, fetchCreditInfo, fetchKeyUsage } from './openrouter.js';
import { getSpendReading, setSpendReading } from '../platform/config.js';
import { nextSpendReading, spentToday } from '../state/today-spend.js';
import { createOllamaProvider } from './ollama.js';
import { createZaiProvider } from './zai.js';
import { createDirectProvider, createCustomProvider } from './direct.js';
import { DIRECT_SERVICES, CUSTOM_SERVICE_ID, directService, isDirectService, serviceNameFor, type DirectServiceId } from './direct-services.js';
import { checkKey, checkCustomService, forgetLiveList, loadCatalogue } from './catalogue.js';
import { getCustomService, setCustomService, getEstimatedSpend } from '../platform/config.js';
import { localDate } from '../state/today-spend.js';
import { session } from '../state/session.js';
import { getKey, setKey, deleteKey, listProviders } from '../keys/store.js';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let active: Provider | null = null;
let resolvedKey: string | null = null;
let zaiKey: string | null = null;
let keySource: 'keychain' | 'env' | null = null;
// Keys for the direct connections and the "any compatible service", by service id.
const serviceKeys = new Map<string, string>();

// The OpenRouter key, for features that call OpenRouter directly (web research).
export function getOpenRouterKey(): string | null {
  return resolvedKey;
}

// The calm provider list shared by the model picker and the key screens.
export const PROVIDER_ROWS = [
  { id: 'openrouter', label: 'OpenRouter', description: 'one key unlocks 400+ models - recommended' },
  { id: 'zai', label: 'Z.ai', description: 'GLM Coding Plan - $18/month flat - best for heavy daily use' },
  { id: 'anthropic', label: 'Anthropic', description: 'Claude, with your own Anthropic key' },
  { id: 'openai', label: 'OpenAI', description: 'GPT, with your own OpenAI key' },
  { id: 'google', label: 'Google', description: 'Gemini, with your own Google AI Studio key' },
  { id: 'xai', label: 'xAI (Grok)', description: 'Grok, with your own xAI key' },
  { id: 'groq', label: 'Groq', description: 'fast open models, with your own Groq key' },
  { id: 'mistral', label: 'Mistral', description: 'Mistral, with your own Mistral key' },
  { id: 'custom', label: 'Other service', description: 'any compatible service - paste its address and key' },
  { id: 'ollama', label: 'Ollama', description: 'models on this computer, no key needed' },
];

export function getKeySource(): 'keychain' | 'env' | null {
  return keySource;
}

// Whether a stored key (or keyless local mode) makes a provider usable today.
export function hasCredentialsFor(providerId: string): boolean {
  if (providerId === 'openrouter') return resolvedKey !== null;
  if (providerId === 'zai') return zaiKey !== null;
  if (providerId === 'ollama') return true;
  if (providerId === CUSTOM_SERVICE_ID) return serviceKeys.has(CUSTOM_SERVICE_ID) && getCustomService() !== null;
  if (isDirectService(providerId)) return serviceKeys.has(providerId);
  return false;
}

// A compatible service may need no key (one running on this computer); this stands in.
export const NO_KEY = 'no-key';

// The key for a direct connection or the compatible service, if one is stored.
export function serviceKey(providerId: string): string | null {
  return serviceKeys.get(providerId) ?? null;
}

// The name of the compatible service, from its address ("Other service" before one is added).
export function customServiceName(): string {
  const saved = getCustomService();
  return saved ? serviceNameFor(saved.baseURL) : 'Other service';
}

export type KeySaveResult = 'saved' | 'saved-unchecked' | 'rejected' | 'keychain';

// Checks a key with the company (a free request for its model list), then stores it.
// A key the company refuses is not stored; when the company can't be reached the key
// is stored anyway and the person is told it could not be checked.
export async function storeDirectKey(serviceId: DirectServiceId, key: string): Promise<KeySaveResult> {
  const check = await checkKey(serviceId, key);
  if (!check.ok && check.reason === 'rejected') return 'rejected';
  if (!(await setKey(serviceId, key))) return 'keychain';
  serviceKeys.set(serviceId, key);
  forgetLiveList(serviceId);
  return check.ok ? 'saved' : 'saved-unchecked';
}

export async function removeServiceKey(serviceId: string): Promise<void> {
  await deleteKey(serviceId);
  serviceKeys.delete(serviceId);
  forgetLiveList(serviceId);
  if (serviceId === CUSTOM_SERVICE_ID) setCustomService(null);
}

// Checks the compatible service's address and key together (it must list its models),
// then stores both. A blank key is allowed for a service on this computer.
export async function storeCustomService(address: string, key: string): Promise<KeySaveResult | 'unreachable'> {
  const secret = key.trim() || NO_KEY;
  const check = await checkCustomService(address, secret);
  if (!check.ok) return check.reason;
  if (!(await setKey(CUSTOM_SERVICE_ID, secret))) return 'keychain';
  setCustomService({ baseURL: check.baseURL });
  serviceKeys.set(CUSTOM_SERVICE_ID, secret);
  return check.keyChecked ? 'saved' : 'saved-unchecked';
}

export function hasCredentials(): boolean {
  return hasCredentialsFor(session.providerId);
}

// Startup key resolution: the Keychain wins; a .env file is a development fallback
// that gets migrated into the Keychain on first launch. The first access may pop a
// macOS permission dialog - that is expected and allowed once.
export async function initKeys(): Promise<void> {
  // Read together, so startup is not held up by one keychain read after another.
  const ids = [...DIRECT_SERVICES.map((service) => service.id), CUSTOM_SERVICE_ID];
  const serviceStored = await Promise.all(ids.map((id) => getKey(id)));
  ids.forEach((id, index) => {
    const key = serviceStored[index];
    if (key && key.length > 0) serviceKeys.set(id, key);
  });
  const storedZai = await getKey('zai');
  if (storedZai && storedZai.length > 0) {
    zaiKey = storedZai;
  }
  const stored = await getKey('openrouter');
  if (stored && stored.length > 0) {
    resolvedKey = stored;
    keySource = 'keychain';
    return;
  }
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey && envKey.length > 0) {
    const moved = await setKey('openrouter', envKey);
    if (moved) {
      removeEnvFile();
      session.addNotice('Your key was moved from a local file into your Mac keychain, and the file was removed.');
    } else {
      session.addNotice('The Mac keychain was not reachable, so the key is being read from a local file for now. Type /keys to store it securely.');
    }
    resolvedKey = envKey;
    keySource = moved ? 'keychain' : 'env';
  }
}

// Only removes the single-key development file this project created - never a custom one.
function removeEnvFile(): void {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '.env');
  if (!existsSync(envPath)) return;
  try {
    const lines = readFileSync(envPath, 'utf8')
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0);
    if (lines.length > 0 && lines.every((line) => line.startsWith('OPENROUTER_API_KEY='))) {
      rmSync(envPath);
    }
  } catch {
    // Cleanup failures must never break startup.
  }
}

// Saves the OpenRouter key in the Keychain and activates it immediately.
export async function storeOpenRouterKey(key: string): Promise<boolean> {
  const saved = await setKey('openrouter', key);
  if (!saved) return false;
  resolvedKey = key;
  keySource = 'keychain';
  active = null;
  return true;
}

// Saves the Z.ai key (GLM Coding Plan) in the Keychain and activates it immediately.
export async function storeZaiKey(key: string): Promise<boolean> {
  const saved = await setKey('zai', key);
  if (!saved) return false;
  zaiKey = key;
  return true;
}

export async function removeZaiKey(): Promise<void> {
  await deleteKey('zai');
  zaiKey = null;
}

// Removes the stored OpenRouter key; an env key becomes the fallback again.
export async function removeOpenRouterKey(): Promise<'env' | null> {
  await deleteKey('openrouter');
  active = null;
  const envKey = process.env.OPENROUTER_API_KEY;
  if (envKey && envKey.length > 0) {
    resolvedKey = envKey;
    keySource = 'env';
    return 'env';
  }
  resolvedKey = null;
  keySource = null;
  return null;
}

export function getActiveProvider(): Provider {
  if (session.providerId === 'ollama') {
    return createOllamaProvider();
  }
  if (session.providerId === 'zai') {
    if (!zaiKey) {
      throw new Error('No Z.ai key yet. Add one with /keys.');
    }
    return createZaiProvider(zaiKey);
  }
  if (session.providerId === CUSTOM_SERVICE_ID) {
    const saved = getCustomService();
    const key = serviceKeys.get(CUSTOM_SERVICE_ID);
    if (!saved || !key) throw new Error('No key yet for the other service. Add one with /model.');
    return createCustomProvider(saved.baseURL, key);
  }
  if (isDirectService(session.providerId)) {
    const key = serviceKeys.get(session.providerId);
    if (!key) throw new Error(`No ${directService(session.providerId)!.label} key yet. Add one with /keys.`);
    // Prices for the cost estimate; loads once, and never fails.
    void loadCatalogue();
    return createDirectProvider(session.providerId, key);
  }
  if (!resolvedKey) {
    throw new Error('No OpenRouter API key yet. Add one with /keys.');
  }
  if (!active) {
    active = createOpenRouterProvider(resolvedKey);
  }
  return active;
}

// Best-effort credit refresh. The management key sees the real account balance;
// the inference key only sees its own spending cap, which is labelled as such.
// Local Ollama has no credit balance, and failures are silent.
export async function refreshCredit(): Promise<void> {
  if (session.providerId !== 'openrouter') {
    // Direct connections: today's spending as worked out from price lists.
    session.setTodaySpend(Math.max(session.todaySpend ?? 0, estimatedToday()));
    return;
  }
  void refreshTodaySpend();
  const managementKey = await getKey('openrouter-management');
  if (managementKey) {
    const info = await fetchCreditInfo(managementKey);
    if (info) {
      session.setCredit(info.used, info.limit, info.remaining, true);
      return;
    }
  }
  if (!resolvedKey) return;
  const info = await fetchCreditInfo(resolvedKey);
  if (info) {
    session.setCredit(info.used, info.limit, info.remaining, false);
  }
}

// Today's spend on the key Jeeves uses, in the user's local calendar day.
async function refreshTodaySpend(): Promise<void> {
  if (!resolvedKey) return;
  const usage = await fetchKeyUsage(resolvedKey);
  if (usage === null) return;
  const reading = nextSpendReading(getSpendReading(), usage, new Date());
  setSpendReading(reading);
  // Never lower than the live figure: the key's total can lag a request or two behind.
  session.setTodaySpend(Math.max(session.todaySpend ?? 0, spentToday(reading) + estimatedToday()));
}

// Today's spending on direct connections, worked out from price lists.
export function estimatedToday(now = new Date()): number {
  const saved = getEstimatedSpend();
  return saved && saved.date === localDate(now) ? saved.amount : 0;
}

// Which providers have a key in the OS credential store.
export async function storedKeyProviders(): Promise<string[]> {
  return listProviders();
}