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
import { repairToolCall } from './repair.js';
import { prepareStepFor, stepCost, type FinishedStep } from './step-control.js';
import { collectStream, MAX_TOOL_STEPS } from './stream-driver.js';
import { directService, serviceNameFor, CUSTOM_SERVICE_ID, type DirectServiceId } from './direct-services.js';
import { estimateCost, priceOf, type StepUsage } from './catalogue.js';
import { chatGptModelFactory, currentChatGptStore } from './chatgpt.js';

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
    case 'chatgpt':
      // No key: the person's ChatGPT plan, its tokens kept fresh by the store (chatgpt.ts).
      return chatGptModelFactory(currentChatGptStore());
    default: {
      // Every other company in the catalogue: the OpenAI request format at its address.
      const client = createOpenAICompatible({ name: serviceId, baseURL: directService(serviceId)?.baseURL ?? '', apiKey, includeUsage: true });
      return (id) => client.chatModel(id);
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
  caching: boolean,
  // ChatGPT's own address wants the rulebook in its own field, not as a system message, and nothing stored.
  codex = false
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
      // Each company gets its own request (caching marks, the ChatGPT address's
      // own fields); the READING of the reply is the one shared stream driver.
      const result = streamText({
        instructions: codex ? undefined : system,
        providerOptions: codex ? { openai: { instructions: instructions ?? '', store: false } } : undefined,
        // The same limits on silence as the other services (see openrouter.ts).
        // Silence while the model answers is watched by silenceGuard (it pauses while a
        // command runs or waits for the person); the first piece still has 2 minutes.
        timeout: { firstChunkMs: 120_000 },
        model: modelFor(modelId),
        messages: caching ? markForCaching(messages) : messages,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        repairToolCall,
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
      return collectStream(result, guard, { onToken, onReasoning, onToolCall }, ({ steps }) => ({
        // Worked out from the price list: these services don't report a cost.
        stepCosts: steps.map(stepCostOf),
      }));
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
    serviceId === 'anthropic',
    serviceId === 'chatgpt'
  );
}

// The "any compatible service": most AI services accept the OpenAI request format at
// an address ending in /v1. Its prices are unknown, so its cost can't be estimated.
export function createCustomProvider(baseURL: string, apiKey: string): Provider {
  const client = createOpenAICompatible({ name: 'custom', baseURL, apiKey, includeUsage: true });
  return streamWith(CUSTOM_SERVICE_ID, serviceNameFor(baseURL), (id) => client.chatModel(id), () => 0, false);
}
