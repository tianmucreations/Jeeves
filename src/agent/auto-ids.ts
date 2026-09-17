// The Auto mode model ids, in a module with no imports so the model catalogue can
// use them without a dependency loop.
export const AUTO_MODEL_ID = 'jeeves/auto';
export const AUTO_WORKER_MODEL = 'deepseek/deepseek-v4-flash-0731';
// Provisional: the expert is chosen by the measured comparison before release.
export const AUTO_EXPERT_MODEL = process.env.JEEVES_EXPERT_MODEL || 'anthropic/claude-sonnet-5';
// The last rung, only ever used after asking: the strongest model for a job the
// expert could not finish either.
export const AUTO_TOP_MODEL = 'anthropic/claude-opus-5';
