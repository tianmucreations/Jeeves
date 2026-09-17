// The Auto mode model ids, in a module with no imports so the model catalogue can
// use them without a dependency loop.
export const AUTO_MODEL_ID = 'jeeves/auto';

// Models retire and names change (the worker's name ends in a date), so each role
// has a short list of replacements, used in order - the first one still in the
// catalogue with tool support wins. Every id was checked live on 17 Sept 2026.
// The first choices were measured in the model comparison; the replacements after
// them were chosen as the nearest measured or same-family alternatives:
// - worker: DeepSeek V4 Flash (dated name), then its undated name, then GLM 5.3
//   (6 of 6 on the hardest jobs when working alone, at a higher price);
// - expert: Claude Sonnet 5 (6 of 6; its reviews fixed the hard failures), then
//   GLM 5.3 (6 of 6 alone), then Claude Opus 5;
// - strongest model for the last rung: Claude Opus 5.
export const WORKER_MODELS = ['deepseek/deepseek-v4-flash-0731', 'deepseek/deepseek-v4-flash', 'z-ai/glm-5.3'];
export const EXPERT_MODELS = [
  ...(process.env.JEEVES_EXPERT_MODEL ? [process.env.JEEVES_EXPERT_MODEL] : []),
  'anthropic/claude-sonnet-5',
  'z-ai/glm-5.3',
  'anthropic/claude-opus-5',
];
export const TOP_MODELS = ['anthropic/claude-opus-5'];

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
