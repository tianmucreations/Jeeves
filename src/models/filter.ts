import type { ModelInfo } from './registry.js';

// A model can drive the agent only if OpenRouter reports tool support (spec 4.1).
export function isToolCapable(model: ModelInfo): boolean {
  return model.supportedParameters.includes('tools') || model.supportedParameters.includes('tool_choice');
}