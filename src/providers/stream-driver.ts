// THE STREAM DRIVER — the one piece of code that reads a model's reply and turns
// it into a Jeeves result (3 Oct refactor).
//
// Before this file the same ~40 lines were copy-pasted into all four provider
// files (Z.ai, OpenRouter, the direct services, Ollama): the same part switch,
// the same error precedence, the same usage maths, the same step-cap formula.
// Four copies of one piece of logic meant four places to fix and three places
// to forget. Now each provider only builds its own REQUEST (its client, its
// options) and hands the reply here; the reading of it happens exactly once.
import type { ModelMessage } from 'ai';
import type { SilenceGuard } from './silence.js';
import type { StreamResult, RateLimitInfo } from './types.js';

// One mechanism for every provider, as the 2 Oct rule requires: the brakes are
// the person, the permission questions and the money limit - never a step count.
// (Was declared four times, once per provider, and could drift.)
export const MAX_TOOL_STEPS = 200;

// The reply object the AI SDK hands back. Typed loosely on purpose: the four
// client packages build it slightly differently, but these members are the same.
// S is the step shape each provider's client produces - it flows through so the
// provider's own step maths keeps its exact types.
export interface StreamHandle<S = never> {
  stream: AsyncIterable<{
    type: string;
    text?: string;
    toolCallId?: string;
    toolName?: string;
    error?: unknown;
  }>;
  text: PromiseLike<string>;
  finalStep: PromiseLike<{
    reasoningText?: string;
    finishReason: string;
    response?: { headers?: Record<string, string> };
  }>;
  responseMessages: PromiseLike<ModelMessage[]>;
  usage: PromiseLike<{
    inputTokens?: number | null;
    outputTokens?: number | null;
    totalTokens?: number | null;
    inputTokenDetails?: { cacheReadTokens?: number } | null;
  }>;
  steps: PromiseLike<S[]>;
}

// What a provider can add on top of the common result: OpenRouter reads its
// rate-limit headers and per-step costs; the direct services price their steps
// from the catalogue; Ollama reports no cached tokens.
export interface ProviderExtras {
  rateLimit?: RateLimitInfo | null;
  stepCosts?: number[];
  cached?: number;
}

// Reads one reply to the end and assembles the result.
//
// Order of operations that must never change: the guard watches every part for
// stalls (and pauses while a tool runs); a REAL stream error (a rejected key, a
// missing model) wins over the SDK's generic no-output error, which would
// otherwise mask the cause.
export async function collectStream<S>(
  handle: StreamHandle<S>,
  guard: SilenceGuard,
  sinks: { onToken: (text: string) => void; onReasoning: (text: string) => void; onToolCall: (call: { id: string; name: string }) => void },
  extras?: (parts: { finalStep: Awaited<StreamHandle['finalStep']>; usage: Awaited<StreamHandle['usage']>; steps: S[] }) => ProviderExtras,
): Promise<StreamResult> {
  let streamedError: unknown = null;
  for await (const part of handle.stream) {
    guard.onPart(part);
    if (part.type === 'text-delta') {
      sinks.onToken(part.text ?? '');
    } else if (part.type === 'reasoning-delta') {
      sinks.onReasoning(part.text ?? '');
    } else if (part.type === 'tool-call') {
      sinks.onToolCall({ id: part.toolCallId ?? '', name: part.toolName ?? '' });
    } else if (part.type === 'error') {
      streamedError = part.error;
    }
  }
  guard.stop();
  if (streamedError !== null) {
    throw streamedError instanceof Error ? streamedError : new Error(String(streamedError));
  }
  const text = await handle.text;
  const finalStep = await handle.finalStep;
  const responseMessages = await handle.responseMessages;
  const usage = await handle.usage;
  const steps = await handle.steps;
  const added = extras?.({ finalStep, usage, steps }) ?? {};
  return {
    text,
    reasoning: finalStep.reasoningText ?? '',
    messages: responseMessages,
    usage: {
      input: usage.inputTokens ?? 0,
      output: usage.outputTokens ?? 0,
      total: usage.totalTokens ?? 0,
      cached: added.cached ?? usage.inputTokenDetails?.cacheReadTokens ?? 0,
    },
    cost: 0,
    rateLimit: added.rateLimit ?? null,
    stepCosts: added.stepCosts,
    hitStepCap: steps.length >= MAX_TOOL_STEPS && finalStep.finishReason === 'tool-calls',
    finishReason: finalStep.finishReason,
  };
}

// The numbers from a rate-limit header row, or null when none are usable.
export function headerNumber(headers: Record<string, string> | undefined, name: string): number | null {
  const raw = headers?.[name];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}
