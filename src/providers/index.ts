import type { Provider } from './types.js';
import { createOpenRouterProvider, fetchCreditInfo } from './openrouter.js';
import { createOllamaProvider } from './ollama.js';
import { session } from '../state/session.js';
import { getKey, setKey, deleteKey, listProviders } from '../keys/store.js';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let active: Provider | null = null;
let resolvedKey: string | null = null;
let keySource: 'keychain' | 'env' | null = null;

// The calm provider list shared by the model picker and the key screens.
export const PROVIDER_ROWS = [
  { id: 'openrouter', label: 'OpenRouter', description: 'one key unlocks 400+ models - recommended' },
  { id: 'anthropic', label: 'Anthropic', description: 'direct connection' },
  { id: 'openai', label: 'OpenAI', description: 'direct connection' },
  { id: 'google', label: 'Google', description: 'direct connection' },
  { id: 'xai', label: 'xAI', description: 'direct connection' },
  { id: 'groq', label: 'Groq', description: 'direct connection' },
  { id: 'mistral', label: 'Mistral', description: 'direct connection' },
  { id: 'ollama', label: 'Ollama', description: 'local models, no key needed' },
];

export function getKeySource(): 'keychain' | 'env' | null {
  return keySource;
}

export function hasCredentials(): boolean {
  return resolvedKey !== null;
}

// Startup key resolution: the Keychain wins; a .env file is a development fallback
// that gets migrated into the Keychain on first launch. The first access may pop a
// macOS permission dialog - that is expected and allowed once.
export async function initKeys(): Promise<void> {
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
      session.addNotice('Your API key was moved from the .env file into your Mac keychain. The .env file has been removed.');
    } else {
      session.addNotice('The Mac keychain was not reachable, so the .env development file is being used. Run /keys to store the key securely.');
    }
    resolvedKey = envKey;
    keySource = moved ? 'keychain' : 'env';
  }
}

// Only removes the single-key development file this project created - never a custom one.
function removeEnvFile(): void {
  const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.env');
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
  if (!resolvedKey) {
    throw new Error('No OpenRouter API key found. Add one with /keys.');
  }
  if (!active) {
    active = createOpenRouterProvider(resolvedKey);
  }
  return active;
}

// Best-effort credit refresh; local Ollama has no credit balance, and failures are silent.
export async function refreshCredit(): Promise<void> {
  if (session.providerId !== 'openrouter' || !resolvedKey) return;
  const info = await fetchCreditInfo(resolvedKey);
  if (info) {
    session.setCredit(info.used, info.limit, info.remaining);
  }
}

// Which providers have a key in the OS credential store.
export async function storedKeyProviders(): Promise<string[]> {
  return listProviders();
}