import { streamText, stepCountIs, type LanguageModel, type ModelMessage, type SystemModelMessage } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import { createGoogle } from '@ai-sdk/google';
import { createXai } from '@ai-sdk/xai';
import { createMistral } from '@ai-sdk/mistral';
import { createGroq } from '@ai-sdk/groq';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Provider, StreamOptions, StreamResult } from './types.js';
import { silenceGuard } from './silence.js';
import { prepareStepFor, type FinishedStep } from './step-control.js';
import { directService, serviceNameFor, CUSTOM_SERVICE_ID, type DirectServiceId } from './direct-services.js';
import { estimateCost, priceOf, type StepUsage } from './catalogue.js';

const MAX_TOOL_STEPS = 25;

// Each company's official AI SDK package, at its default model type (OpenCode does the same).
export function modelFactory(serviceId: DirectServiceId, apiKey: string): (modelId: string) => LanguageModel {
  switch (serviceId) {
    case 'anthropic': {
      const client = createAnthropic({ apiKey });
      return (id) => client.languageModel(id);
    }
    case 'openai': {
      const client = createOpenAI({ apiKey });
      return (id) => client.languageModel(id);
    }
    case 'google': {
      const client = createGoogle({ apiKey });
      return (id) => client.languageModel(id);
    }
    case 'xai': {
      const client = createXai({ apiKey });
      return (id) => client.languageModel(id);
    }
    case 'mistral': {
      const client = createMistral({ apiKey });
      return (id) => client.languageModel(id);
    }
    case 'groq': {
      const client = createGroq({ apiKey });
      return (id) => client.languageModel(id);
    }
  }
}

const ANTHROPIC_CACHE = { anthropic: { cacheControl: { type: 'ephemeral' } } } as const;

// Anthropic only reuses the unchanged start of a conversation (at a tenth of the
// price) when told where it ends. As OpenCode does: mark the rulebook and the last
// two messages. Anthropic allows four marks, so marks on older messages are removed,
// and the stored conversation is never changed (copies are marked).
export function markForCaching(messages: ModelMessage[]): ModelMessage[] {
  const firstMarked = messages.length - 2;
  return messages.map((message, index) => {
    const options = message.providerOptions as Record<string, Record<string, unknown>> | undefined;
    if (index >= firstMarked) {
      return { ...message, providerOptions: { ...options, anthropic: { ...options?.anthropic, ...ANTHROPIC_CACHE.anthropic } } } as ModelMessage;
    }
    if (!options?.anthropic?.cacheControl) return message;
    const { cacheControl, ...keep } = options.anthropic;
    void cacheControl;
    const { anthropic, ...others } = options;
    void anthropic;
    return { ...message, providerOptions: Object.keys(keep).length > 0 ? { ...others, anthropic: keep } : others } as ModelMessage;
  });
}

function streamWith(
  id: string,
  name: string,
  modelFor: (modelId: string) => LanguageModel,
  costOf: (modelId: string, usage: StepUsage) => number,
  caching: boolean
): Provider {
  return {
    id,
    name,
    async stream({ modelId, messages, tools, instructions, onToken, onReasoning, onToolCall, beforeStep, abortSignal }: StreamOptions): Promise<StreamResult> {
      const stepCostOf = (step: FinishedStep) => costOf(step.model?.modelId ?? modelId, step.usage ?? {});
      const prepare = prepareStepFor(beforeStep, modelFor, stepCostOf);
      const system: string | SystemModelMessage | undefined =
        caching && instructions ? { role: 'system', content: instructions, providerOptions: ANTHROPIC_CACHE } : instructions;
      const guard = silenceGuard(abortSignal);
      const result = streamText({
        instructions: system,
        // The same limits on silence as the other services (see openrouter.ts).
        // Silence while the model answers is watched by silenceGuard (it pauses while a
        // command runs or waits for the person); the first piece still has 2 minutes.
        timeout: { firstChunkMs: 120_000 },
        model: modelFor(modelId),
        messages: caching ? markForCaching(messages) : messages,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        // The marks move to the newest messages at every step of a job.
        prepareStep:
          prepare || caching
            ? async (step) => {
                const control = prepare ? await prepare(step) : {};
                if (!caching) return control;
                return { ...control, messages: markForCaching(control.messages ?? step.messages) };
              }
            : undefined,
        abortSignal: guard.signal,
        // The library prints every failure to the screen by default, over Jeeves's
        // window; the failure still arrives below and is explained in plain English.
        onError: () => {},
      });
      let streamedError: unknown = null;
      for await (const part of result.stream) {
        guard.onPart(part);
        if (part.type === 'text-delta') {
          onToken(part.text);
        } else if (part.type === 'reasoning-delta') {
          onReasoning(part.text);
        } else if (part.type === 'tool-call') {
          onToolCall({ id: part.toolCallId, name: part.toolName });
        } else if (part.type === 'error') {
          streamedError = part.error;
        }
      }
      guard.stop();
      // The real stream error (a rejected key, a missing model) must win over the
      // SDK's generic no-output error, which would otherwise mask the cause.
      if (streamedError !== null) {
        throw streamedError instanceof Error ? streamedError : new Error(String(streamedError));
      }
      const text = await result.text;
      const finalStep = await result.finalStep;
      const responseMessages = await result.responseMessages;
      const usage = await result.usage;
      const steps = await result.steps;
      return {
        text,
        reasoning: finalStep.reasoningText ?? '',
        messages: responseMessages,
        usage: {
          input: usage.inputTokens ?? 0,
          output: usage.outputTokens ?? 0,
          total: usage.totalTokens ?? 0,
          cached: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        },
        cost: 0,
        rateLimit: null,
        // Worked out from the price list: these services don't report a cost.
        stepCosts: steps.map(stepCostOf),
      };
    },
  };
}

export function createDirectProvider(serviceId: DirectServiceId, apiKey: string): Provider {
  const service = directService(serviceId)!;
  return streamWith(
    serviceId,
    service.label,
    modelFactory(serviceId, apiKey),
    (modelId, usage) => estimateCost(priceOf(serviceId, modelId), usage),
    serviceId === 'anthropic'
  );
}

// The "any compatible service": most AI services accept the OpenAI request format at
// an address ending in /v1. Its prices are unknown, so its cost can't be estimated.
export function createCustomProvider(baseURL: string, apiKey: string): Provider {
  const client = createOpenAICompatible({ name: 'custom', baseURL, apiKey, includeUsage: true });
  return streamWith(CUSTOM_SERVICE_ID, serviceNameFor(baseURL), (id) => client.chatModel(id), () => 0, false);
}
