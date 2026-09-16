import { streamText, stepCountIs } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Provider, StreamOptions, StreamResult } from './types.js';
import type { ModelInfo } from '../models/registry.js';

// Z.ai's coding endpoint speaks the Anthropic Messages protocol, so the official
// Anthropic adapter talks to it directly. The base URL must include /v1 because
// the appends /messages to it.
const ZAI_BASE_URL = 'https://api.z.ai/api/anthropic/v1';
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
  const client = createAnthropic({
    apiKey,
    baseURL: ZAI_BASE_URL,
  });
  return {
    id: 'zai',
    name: 'Z.ai',
    async stream({ modelId, messages, tools, instructions, onToken, onReasoning, onToolCall }: StreamOptions): Promise<StreamResult> {
      const result = streamText({
        instructions,
        // A stalled request must never wedge the app in the working state forever.
        timeout: 180_000,
        model: client(modelId),
        messages,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
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
      const text = await result.text;
      if (!text && streamedError !== null) {
        throw streamedError instanceof Error ? streamedError : new Error(String(streamedError));
      }
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
