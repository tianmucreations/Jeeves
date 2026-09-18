// The model makers Jeeves connects to directly, each with the user's own key.
// A module with no imports, so the catalogue, key screens and picker can all use it.
//
// Approach copied from OpenCode (anomalyco/opencode, packages/opencode/src/provider):
// the official AI SDK package for each company, and prices and abilities from the
// open models.dev catalogue (MIT licence), which OpenCode also uses.

export type DirectServiceId = 'anthropic' | 'openai' | 'google' | 'xai' | 'mistral' | 'groq';

export interface DirectService {
  id: DirectServiceId;
  label: string;
  // Where to get a key, shown on the key screen.
  keyPage: string;
  // Each company's everyday model first, then replacements if it retires. Chosen
  // 18 Sept 2026 from each company's own descriptions and prices in models.dev (the
  // balanced tier - not the most expensive); not yet measured on the bench (plan step 6).
  defaults: string[];
}

export const DIRECT_SERVICES: DirectService[] = [
  {
    id: 'anthropic',
    label: 'Anthropic',
    keyPage: 'console.anthropic.com/settings/keys',
    defaults: ['claude-sonnet-5', 'claude-sonnet-4-6', 'claude-sonnet-4-5'],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    keyPage: 'platform.openai.com/api-keys',
    defaults: ['gpt-5.6-terra', 'gpt-5.5', 'gpt-5.4'],
  },
  {
    id: 'google',
    label: 'Google',
    keyPage: 'aistudio.google.com/apikey',
    defaults: ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash'],
  },
  {
    id: 'xai',
    label: 'xAI (Grok)',
    keyPage: 'console.x.ai',
    defaults: ['grok-4.6', 'grok-4.5', 'grok-4.3'],
  },
  {
    id: 'mistral',
    label: 'Mistral',
    keyPage: 'console.mistral.ai/api-keys',
    defaults: ['mistral-medium-latest', 'mistral-large-latest', 'mistral-small-latest'],
  },
  {
    id: 'groq',
    label: 'Groq',
    keyPage: 'console.groq.com/keys',
    defaults: ['openai/gpt-oss-120b', 'qwen/qwen3.8-27b', 'llama-3.3-70b-versatile'],
  },
];

// "Any compatible service": an address and a key the person pastes in.
export const CUSTOM_SERVICE_ID = 'custom';

export function directService(id: string): DirectService | undefined {
  return DIRECT_SERVICES.find((service) => service.id === id);
}

export function isDirectService(id: string): id is DirectServiceId {
  return directService(id) !== undefined;
}

// Services whose cost Jeeves works out from a price list (not reported by the service).
export function isEstimatedCostService(id: string): boolean {
  return isDirectService(id) || id === CUSTOM_SERVICE_ID;
}

// The name a compatible service is known by: its web address without "api." or "www.".
export function serviceNameFor(baseURL: string): string {
  try {
    return new URL(baseURL).hostname.replace(/^(api|www)\./, '');
  } catch {
    return 'your service';
  }
}
