// The model makers Jeeves connects to directly, each with the user's own key.
// A module with no imports, so the catalogue, key screens and picker can all use it.
//
// Approach copied from OpenCode (anomalyco/opencode, packages/opencode/src/provider):
// the official AI SDK package for each company, and prices and abilities from the
// open models.dev catalogue (MIT licence), which OpenCode also uses.

// The six with their own official packages, plus (like OpenCode's list of ~100) every
// OpenAI-compatible company in the models.dev catalogue, added at run time below.
export type DirectServiceId = string;

export interface DirectService {
  id: DirectServiceId;
  label: string;
  // Where to get a key, shown on the key screen.
  keyPage: string;
  // Each company's everyday model first, then replacements if it retires. Chosen
  // 18 Sept 2026 from each company's own descriptions and prices in models.dev (the
  // balanced tier - not the most expensive); not yet measured on the bench (plan step 6).
  defaults: string[];
  // Companies added from the catalogue: the address requests go to.
  baseURL?: string;
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
    // Signing in with a ChatGPT Plus or Pro plan instead of a key (providers/chatgpt.ts).
    id: 'chatgpt',
    label: 'ChatGPT',
    keyPage: 'chatgpt.com',
    defaults: ['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini'],
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

// The catalogue's other companies (models.dev entries that speak the OpenAI format
// at a fixed web address), filled in once the catalogue has loaded.
export interface CompatibleProvider {
  id: string;
  name: string;
  baseURL: string;
  keyPage: string;
}
let compatible = new Map<string, DirectService>();

// Ids Jeeves already treats specially, never taken over by a catalogue entry.
const RESERVED = new Set(['openrouter', 'zai', 'ollama', 'custom', 'opencode-go', 'zai-coding-plan']);

export function registerCompatible(list: CompatibleProvider[]): void {
  const next = new Map<string, DirectService>();
  for (const item of list) {
    if (RESERVED.has(item.id) || DIRECT_SERVICES.some((service) => service.id === item.id)) continue;
    next.set(item.id, { id: item.id, label: item.name, keyPage: item.keyPage, defaults: [], baseURL: item.baseURL });
  }
  compatible = next;
}

export function compatibleServices(): DirectService[] {
  return [...compatible.values()];
}

export function directService(id: string): DirectService | undefined {
  return DIRECT_SERVICES.find((service) => service.id === id) ?? compatible.get(id);
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
