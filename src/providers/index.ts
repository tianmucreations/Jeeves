import type { Provider } from './types.js';
import { createOpenRouterProvider, fetchCreditInfo, fetchKeyUsage } from './openrouter.js';
import { getSpendReading, setSpendReading } from '../platform/config.js';
import { nextSpendReading, spentToday } from '../state/today-spend.js';
import { createOllamaProvider } from './ollama.js';
import { createZaiProvider } from './zai.js';
import { session } from '../state/session.js';
import { getKey, setKey, deleteKey, listProviders } from '../keys/store.js';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let active: Provider | null = null;
let resolvedKey: string | null = null;
let zaiKey: string | null = null;
let keySource: 'keychain' | 'env' | null = null;

// The OpenRouter key, for features that call OpenRouter directly (web research).
export function getOpenRouterKey(): string | null {
  return resolvedKey;
}

// The calm provider list shared by the model picker and the key screens.
export const PROVIDER_ROWS = [
  { id: 'openrouter', label: 'OpenRouter', description: 'one key unlocks 400+ models - recommended' },
  { id: 'zai', label: 'Z.ai', description: 'GLM Coding Plan - $18/month flat - best for heavy daily use' },
  { id: 'anthropic', label: 'Anthropic', description: 'models through OpenRouter' },
  { id: 'openai', label: 'OpenAI', description: 'models through OpenRouter' },
  { id: 'google', label: 'Google', description: 'models through OpenRouter' },
  { id: 'xai', label: 'xAI (Grok)', description: 'models through OpenRouter' },
  { id: 'groq', label: 'Groq', description: 'fast hosting of open models, through OpenRouter' },
  { id: 'mistral', label: 'Mistral', description: 'models through OpenRouter' },
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
  return false;
}

export function hasCredentials(): boolean {
  return hasCredentialsFor(session.providerId);
}

// Startup key resolution: the Keychain wins; a .env file is a development fallback
// that gets migrated into the Keychain on first launch. The first access may pop a
// macOS permission dialog - that is expected and allowed once.
export async function initKeys(): Promise<void> {
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
  if (session.providerId !== 'openrouter') return;
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
  session.setTodaySpend(Math.max(session.todaySpend ?? 0, spentToday(reading)));
}

// Which providers have a key in the OS credential store.
export async function storedKeyProviders(): Promise<string[]> {
  return listProviders();
}