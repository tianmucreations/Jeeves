import type { Provider } from './types.js';
import { createOpenRouterProvider } from './openrouter.js';

let active: Provider | null = null;

// Phase 2 bridge: the key is read from the OPENROUTER_API_KEY environment variable until the
// secure OS credential store lands in Phase 7.
export function getOpenRouterApiKey(): string | undefined {
  const key = process.env.OPENROUTER_API_KEY;
  return key && key.length > 0 ? key : undefined;
}

export function hasCredentials(): boolean {
  return getOpenRouterApiKey() !== undefined;
}

export function getActiveProvider(): Provider {
  if (!active) {
    const key = getOpenRouterApiKey();
    if (!key) {
      throw new Error('No OpenRouter API key found. Set OPENROUTER_API_KEY and start again.');
    }
    active = createOpenRouterProvider(key);
  }
  return active;
}