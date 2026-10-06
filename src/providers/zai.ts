import { streamText, stepCountIs } from 'ai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import type { Provider, StreamOptions, StreamResult } from './types.js';
import { silenceGuard } from './silence.js';
import { repairToolCall } from './repair.js';
import { prepareStepFor } from './step-control.js';
import { collectStream, MAX_TOOL_STEPS } from './stream-driver.js';
import type { ModelInfo } from '../models/registry.js';

// The GLM Coding Plan endpoint: OpenAI Chat Completions protocol at
// https://api.z.ai/api/coding/paas/v4 - NOT the standard /api/paas/v4, which is
// the pay-per-token API. Connected with @ai-sdk/openai-compatible, as OpenCode does
// (models.dev "zai-coding-plan"): unlike the OpenRouter client used before, it reads
// Z.ai's thinking (reasoning_content), so Jeeves can say it is thinking. GLM-5.3
// thinks for up to half a minute before answering; with the old client that time
// showed nothing at all (measured 19 Sept: 1,425 thinking tokens, first words at 26 s).
export const ZAI_CODING_BASE_URL = 'https://api.z.ai/api/coding/paas/v4';

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

// The Flash models answer without their private thinking phase. Measured 26 Sept, same
// request ("write about 900 words on the history of Spain"): thinking on, the first
// word came after 70-140 SECONDS of silence (5,000-8,000 thinking chunks spent
// planning paragraph counts); thinking off, after 4 seconds, whole piece in 35. Tool
// calls work the same either way. OpenCode leaves thinking on but its prompt makes
// the model answer in a few lines; Jeeves's people ask for letters and pieces of
// writing, so the wait is removed at its source instead. The bigger GLM-5.3 keeps
// thinking: it is the one to choose for hard jobs.
export function answersWithoutThinking(modelId: string): boolean {
  return /flash/i.test(modelId);
}

export function createZaiProvider(apiKey: string): Provider {
  // A test can point this at a local pretend service (bench/fake-zai.mts) so streaming
  // can be exercised without spending the plan; honoured only when NODE_ENV is test.
  const baseURL = process.env.NODE_ENV === 'test' && process.env.JEEVES_ZAI_BASE_URL ? process.env.JEEVES_ZAI_BASE_URL : ZAI_CODING_BASE_URL;
  const client = createOpenAICompatible({ name: 'zai', apiKey, baseURL, includeUsage: true });
  return {
    id: 'zai',
    name: 'Z.ai',
    async stream({ modelId, messages, tools, instructions, onToken, onReasoning, onToolCall, beforeStep, abortSignal }: StreamOptions): Promise<StreamResult> {
      const guard = silenceGuard(abortSignal);
      // The request is Z.ai's own; the READING of the reply is the one shared
      // stream driver (stream-driver.ts) - the old copy-pasted consume loop is gone.
      const result = streamText({
        instructions,
        // A stalled request must never wedge the app in the working state forever -
        // but a long, healthy job must not be cut off either. So the limits are on
        // silence, not on the whole job: 90 seconds between pieces of a reply (verified
        // to abort a real stream), 2 minutes for the first piece once the reply has
        // started, and 10 minutes for any single step, which also covers a request that
        // never starts answering. (A plain number here limits the entire multi-step
        // job; a 3-minute one killed healthy jobs mid-way in testing.)
        // Silence while the model answers is watched by silenceGuard (it pauses while a
        // command runs or waits for the person); the first piece still has 2 minutes.
        timeout: { firstChunkMs: 120_000 },
        model: client.chatModel(modelId),
        messages,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        repairToolCall,
        prepareStep: prepareStepFor(beforeStep, (id) => client.chatModel(id)),
        abortSignal: guard.signal,
        providerOptions: answersWithoutThinking(modelId) ? { zai: { thinking: { type: 'disabled' } } } : undefined,
        // The library prints every failure to the screen by default, over Jeeves's
        // window; the failure still arrives below and is explained in plain English.
        onError: () => {},
      });
      return collectStream(result, guard, { onToken, onReasoning, onToolCall });
    },
  };
}
