import { streamText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { Provider, StreamOptions, StreamResult } from './types.js';
import { prepareStepFor } from './step-control.js';
import type { ModelInfo } from '../models/registry.js';

// The GLM Coding Plan endpoint: OpenAI Chat Completions protocol at
// https://api.z.ai/api/coding/paas/v4 - NOT the standard /api/paas/v4, which is
// the pay-per-token API. The OpenRouter client speaks the OpenAI protocol, so it
// talks to the coding endpoint directly (the same trick the Ollama adapter uses
// for its OpenAI-compatible endpoint).
export const ZAI_CODING_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';
const MAX_TOOL_STEPS = 25;

// The GLM Coding Plan is flat-rate, so prices are meaningless per token; the picker
// shows "included" instead of a dollar figure (spec: no misleading numbers).
export const ZAI_MODELS: ModelInfo[] = [
  {
    id: 'glm-5.3',
    name: 'GLM-5.3',
    contextLength: 200_000,
    promptPrice: 0,
    completionPrice: 0,
    supportedParameters: ['tools'],
    provider: 'zai',
    priceLabel: 'included',
  },
  {
    id: 'glm-5.3-flash',
    name: 'GLM-5.3-Flash',
    contextLength: 200_000,
    promptPrice: 0,
    completionPrice: 0,
    supportedParameters: ['tools'],
    provider: 'zai',
    priceLabel: 'included',
  },
  {
    id: 'glm-5.2',
    name: 'GLM-5.2',
    contextLength: 1_000_000,
    promptPrice: 0,
    completionPrice: 0,
    supportedParameters: ['tools'],
    provider: 'zai',
    priceLabel: 'included',
  },
  {
    id: 'glm-4.6',
    name: 'GLM-4.6',
    contextLength: 200_000,
    promptPrice: 0,
    completionPrice: 0,
    supportedParameters: ['tools'],
    provider: 'zai',
    priceLabel: 'included',
  },
];

export function createZaiProvider(apiKey: string): Provider {
  const client = createOpenRouter({
    apiKey,
    baseURL: ZAI_CODING_BASE_URL,
    compatibility: 'compatible',
  });
  return {
    id: 'zai',
    name: 'Z.ai',
    async stream({ modelId, messages, tools, instructions, onToken, onReasoning, onToolCall, beforeStep, abortSignal }: StreamOptions): Promise<StreamResult> {
      const result = streamText({
        instructions,
        // A stalled request must never wedge the app in the working state forever -
        // but a long, healthy job must not be cut off either. So the limits are on
        // silence, not on the whole job: 90 seconds between pieces of a reply (verified
        // to abort a real stream), 2 minutes for the first piece once the reply has
        // started, and 10 minutes for any single step, which also covers a request that
        // never starts answering. (A plain number here limits the entire multi-step
        // job; a 3-minute one killed healthy jobs mid-way in testing.)
        timeout: { firstChunkMs: 120_000, chunkMs: 90_000, stepMs: 600_000 },
        model: client.chat(modelId),
        messages,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        prepareStep: prepareStepFor(beforeStep, (id) => client.chat(id)),
        abortSignal,
        // The library prints every failure to the screen by default, over Jeeves's
        // window; the failure still arrives below and is explained in plain English.
        onError: () => {},
      });
      let streamedError: unknown = null;
      for await (const part of result.stream) {
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
      // The real stream error (a rejected key, a missing model) must win over the
      // SDK's generic no-output error, which would otherwise mask the cause.
      if (streamedError !== null) {
        throw streamedError instanceof Error ? streamedError : new Error(String(streamedError));
      }
      const text = await result.text;
      const finalStep = await result.finalStep;
      const responseMessages = await result.responseMessages;
      const usage = await result.usage;
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
      };
    },
  };
}
