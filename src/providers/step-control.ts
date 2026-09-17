import type { LanguageModel, ModelMessage } from 'ai';
import type { StreamOptions } from './types.js';

// Failed tool actions in one step. A person saying no to a permission is not a failure.
export function countToolFailures(content: readonly { type: string; error?: unknown }[]): number {
  return content.filter((part) => part.type === 'tool-error' && !String(part.error).includes('Permission denied by the user')).length;
}

// OpenRouter's own cost figure for one step, from its usage accounting.
export function stepCost(step: { providerMetadata?: unknown }): number {
  const cost = (step.providerMetadata as { openrouter?: { usage?: { cost?: unknown } } } | undefined)?.openrouter?.usage?.cost;
  return typeof cost === 'number' ? cost : 0;
}

// Shared by every provider: turns the app's beforeStep hook into the AI SDK's
// prepareStep, which may swap the model and messages between steps of a job.
export function prepareStepFor(
  beforeStep: StreamOptions['beforeStep'],
  modelFor: (modelId: string) => LanguageModel
) {
  if (!beforeStep) return undefined;
  return async ({ stepNumber, steps, messages }: { stepNumber: number; steps: { content: readonly { type: string; error?: unknown }[]; providerMetadata?: unknown }[]; messages: ModelMessage[] }) => {
    const control = await beforeStep({
      stepNumber,
      stepFailures: steps.map((step) => countToolFailures(step.content)),
      stepCosts: steps.map(stepCost),
      messages,
    });
    return {
      ...(control.modelId ? { model: modelFor(control.modelId) } : {}),
      ...(control.messages ? { messages: control.messages } : {}),
    };
  };
}
