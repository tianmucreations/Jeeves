import { streamText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { Provider, StreamOptions, StreamResult } from './types.js';
import { silenceGuard } from './silence.js';
import { repairToolCall } from './repair.js';
import { prepareStepFor } from './step-control.js';
import type { ModelInfo } from '../models/registry.js';

const OLLAMA_BASE_URL = 'http://localhost:11434/v1';
const MAX_TOOL_STEPS = 25;

// Ollama exposes an OpenAI-compatible endpoint, so the OpenRouter client speaks to it directly.
export function createOllamaProvider(): Provider {
  const client = createOpenRouter({
    apiKey: 'ollama',
    baseURL: OLLAMA_BASE_URL,
    compatibility: 'compatible',
  });
  return {
    id: 'ollama',
    name: 'Ollama',
    async stream({ modelId, messages, tools, instructions, onToken, onReasoning, onToolCall, beforeStep, abortSignal }: StreamOptions): Promise<StreamResult> {
      const guard = silenceGuard(abortSignal);
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
        model: client.chat(modelId),
        messages,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        repairToolCall,
        prepareStep: prepareStepFor(beforeStep, (id) => client.chat(id)),
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
          cached: 0,
        },
        cost: 0,
        rateLimit: null,
        hitStepCap: steps.length >= MAX_TOOL_STEPS && finalStep.finishReason === 'tool-calls',
        finishReason: finalStep.finishReason,
      };
    },
  };
}

// Maps the local Ollama model list (/api/tags) into picker rows.
export function mapOllamaTags(body: unknown): ModelInfo[] {
  if (typeof body !== 'object' || body === null) return [];
  const models = (body as { models?: unknown }).models;
  if (!Array.isArray(models)) return [];
  const out: ModelInfo[] = [];
  for (const raw of models) {
    if (typeof raw !== 'object' || raw === null) continue;
    const entry = raw as Record<string, unknown>;
    const name = typeof entry.name === 'string' ? entry.name : '';
    if (!name) continue;
    const info = (typeof entry.model_info === 'object' && entry.model_info !== null ? entry.model_info : {}) as Record<string, unknown>;
    out.push({
      id: name,
      name,
      contextLength: typeof info.context_length === 'number' ? info.context_length : 0,
      promptPrice: 0,
      completionPrice: 0,
      // Assumption: current Ollama models handle tools through the OpenAI-compatible endpoint.
      supportedParameters: ['tools'],
      provider: 'ollama',
    });
  }
  return out;
}

export async function listLocalOllamaModels(): Promise<ModelInfo[]> {
  const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1500) });
  if (!response.ok) throw new Error('Ollama on this computer did not respond');
  return mapOllamaTags(await response.json());
}

export async function isOllamaOnline(): Promise<boolean> {
  try {
    const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(1200) });
    return response.ok;
  } catch {
    return false;
  }
}