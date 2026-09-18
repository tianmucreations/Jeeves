import type { LanguageModel, ModelMessage } from 'ai';
import type { StreamOptions } from './types.js';
import type { StepUsage } from './catalogue.js';

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
// The parts of a finished step Jeeves reads.
export interface FinishedStep {
  content: readonly { type: string; error?: unknown }[];
  providerMetadata?: unknown;
  model?: { modelId: string };
  usage?: StepUsage;
}

// costOf: what a finished step cost - OpenRouter's own figure unless the service
// works it out from a price list (the direct connections).
export function prepareStepFor(
  beforeStep: StreamOptions['beforeStep'],
  modelFor: (modelId: string) => LanguageModel,
  costOf: (step: FinishedStep) => number = stepCost
) {
  if (!beforeStep) return undefined;
  return async ({ stepNumber, steps, messages }: { stepNumber: number; steps: FinishedStep[]; messages: ModelMessage[] }) => {
    const control = await beforeStep({
      stepNumber,
      stepFailures: steps.map((step) => countToolFailures(step.content)),
      stepCosts: steps.map(costOf),
      messages,
    });
    return {
      ...(control.modelId ? { model: modelFor(control.modelId) } : {}),
      ...(control.messages ? { messages: control.messages } : {}),
    };
  };
}
