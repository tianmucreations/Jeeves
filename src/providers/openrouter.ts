import { streamText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { Provider, StreamOptions, StreamResult } from './types.js';

// Assumption: the spec's "maxSteps" is called stopWhen/stepCountIs in AI SDK 7 (the installed version); same cap of 25.
const MAX_TOOL_STEPS = 25;

export function createOpenRouterProvider(apiKey: string): Provider {
  const openrouter = createOpenRouter({ apiKey });
  return {
    id: 'openrouter',
    name: 'OpenRouter',
    async stream({ modelId, messages, tools, onToken, onToolCall }: StreamOptions): Promise<StreamResult> {
      const result = streamText({
        model: openrouter.chat(modelId),
        messages,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
      });

      let streamedError: unknown = null;
      for await (const part of result.stream) {
        if (part.type === 'text-delta') {
          onToken(part.text);
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

      const reasoning = (await result.finalStep).reasoningText ?? '';
      const responseMessages = await result.responseMessages;
      const usage = await result.usage;

      return {
        text,
        reasoning,
        messages: responseMessages,
        usage: {
          input: usage.inputTokens ?? 0,
          output: usage.outputTokens ?? 0,
          total: usage.totalTokens ?? 0,
        },
        cost: 0,
      };
    },
  };
}