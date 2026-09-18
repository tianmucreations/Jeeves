// The Auto mode model ids, in a module with no imports so the model catalogue can
// use them without a dependency loop.
export const AUTO_MODEL_ID = 'jeeves/auto';

// Models retire and names change (the worker's name ends in a date), so each role
// has a short list of replacements, used in order - the first one still in the
// catalogue with tool support wins. Every id was checked live on 17 Sept 2026.
// The first choices were measured in the model comparison; the replacements after
// them were chosen as the nearest measured or same-family alternatives:
// - worker: DeepSeek V4 Flash (dated name), then its undated name, then GLM 5.3
//   Flash (15 of 15 on the bench on 17 Sept, including 2 of 2 on the calculator job,
//   at a similar low price), then GLM 5.3 (6 of 6 on the hardest jobs, but about 15
//   times the price - the last resort);
// - expert: Claude Sonnet 5 (6 of 6; its reviews fixed the hard failures), then
//   GLM 5.3 (6 of 6 alone), then Claude Opus 5;
// - strongest model for the last rung: Claude Opus 5.
// JEEVES_WORKER_MODEL lets the bench try another worker, as JEEVES_EXPERT_MODEL does the expert.
export const WORKER_MODELS = [
  ...(process.env.JEEVES_WORKER_MODEL ? [process.env.JEEVES_WORKER_MODEL] : []),
  'deepseek/deepseek-v4-flash-0731',
  'deepseek/deepseek-v4-flash',
  'z-ai/glm-5.3-flash',
  'z-ai/glm-5.3',
];
export const EXPERT_MODELS = [
  ...(process.env.JEEVES_EXPERT_MODEL ? [process.env.JEEVES_EXPERT_MODEL] : []),
  'anthropic/claude-sonnet-5',
  'z-ai/glm-5.3',
  'anthropic/claude-opus-5',
];
export const TOP_MODELS = ['anthropic/claude-opus-5'];

// Auto's models for each service it runs on. A service without an entry offers no Auto.
export interface AutoProfile {
  workers: string[];
  experts: string[];
  top: string[];
}

export const AUTO_PROFILES: Record<string, AutoProfile> = {
  openrouter: { workers: WORKER_MODELS, experts: EXPERT_MODELS, top: TOP_MODELS },
  // OpenAI with the person's own key. Chosen 18 Sept from public results (GPT-5.6 Luna
  // scores near the top models at a tenth of the price), then measured through
  // OpenRouter: Luna working with Terra as expert passed 6 of 6 of the telling jobs
  // (letter, website, calculator, share tracker) at about 4 cents a job. Replacements:
  // GPT-5.4 mini (OpenAI's small model for tool work) and GPT-5.5 - not measured.
  openai: { workers: ['gpt-5.6-luna', 'gpt-5.4-mini'], experts: ['gpt-5.6-terra', 'gpt-5.5'], top: ['gpt-5.6-sol'] },
  // Google with the person's own key (the owner's choice, 18 Sept). Measured through
  // OpenRouter: Gemini 3.8 Flash working with 3.5 Flash as expert passed 4 of 5 of the
  // telling jobs (the failure was a web-search fault since fixed), at 10-14 cents a job -
  // about three times OpenAI's. Replacements (not measured): the Flash "latest" alias and
  // 3.5 Flash; the strongest: 3.1 Pro.
  google: { workers: ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.5-flash'], experts: ['gemini-3.5-flash', 'gemini-3.1-pro-preview'], top: ['gemini-3.1-pro-preview'] },
};

export function autoProfile(providerId: string): AutoProfile | null {
  return AUTO_PROFILES[providerId] ?? null;
}

// First choices, for places that need a name before the catalogue has loaded.
export const AUTO_WORKER_MODEL = WORKER_MODELS[0];
export const AUTO_EXPERT_MODEL = EXPERT_MODELS[0];
export const AUTO_TOP_MODEL = TOP_MODELS[0];

interface CatalogueEntry {
  id: string;
  supportedParameters?: string[];
}

// The first model in the list that is still in the catalogue and can use tools.
// Before the catalogue has loaded (or when it could not be loaded) the first choice
// is used, and a retired model then surfaces as a plain "not available" message.
export function firstAvailable(candidates: string[], catalogue: CatalogueEntry[]): string | null {
  if (catalogue.length === 0) return candidates[0] ?? null;
  for (const id of candidates) {
    const model = catalogue.find((entry) => entry.id === id);
    const params = model?.supportedParameters ?? [];
    if (model && (params.includes('tools') || params.includes('tool_choice'))) return id;
  }
  return null;
}
