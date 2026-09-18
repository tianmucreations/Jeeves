import { randomUUID } from 'node:crypto';
import { streamText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { Provider, StreamOptions, StreamResult, RateLimitInfo } from './types.js';
import { prepareStepFor, stepCost } from './step-control.js';

// Assumption: the spec's "maxSteps" is called stopWhen/stepCountIs in AI SDK 7 (the installed version); same cap of 25.
const MAX_TOOL_STEPS = 25;

// Sticky routing: one id per conversation, sent with every request. OpenRouter uses
// it directly as the routing key, pinning the conversation to one provider endpoint
// so the repeated context hits that endpoint's prompt cache (cache reads bill at
// roughly 0.1-0.5x the fresh-input price). /clear rotates it for a fresh conversation.
let stickySessionId = randomUUID();

export function resetStickySession(): void {
  stickySessionId = randomUUID();
}

export function getStickySessionId(): string {
  return stickySessionId;
}

export interface CreditInfo {
  used: number;
  limit: number;
  remaining: number;
}

// Reads the account's credit position from OpenRouter; returns null when unavailable.
export async function fetchCreditInfo(apiKey: string): Promise<CreditInfo | null> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/credits', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { total_credits?: number; total_usage?: number } };
    const data = body.data;
    if (!data || typeof data.total_credits !== 'number' || typeof data.total_usage !== 'number') {
      return null;
    }
    return {
      used: data.total_usage,
      limit: data.total_credits,
      remaining: data.total_credits - data.total_usage,
    };
  } catch {
    return null;
  }
}

// The key's all-time spend in dollars, from GET /api/v1/key (field "usage",
// confirmed against a live response). Used to work out today's spend in local time.
export async function fetchKeyUsage(apiKey: string): Promise<number | null> {
  try {
    const response = await fetch('https://openrouter.ai/api/v1/key', {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { usage?: number } };
    return typeof body.data?.usage === 'number' ? body.data.usage : null;
  } catch {
    return null;
  }
}

function headerNumber(headers: Record<string, string> | undefined, name: string): number | null {
  const raw = headers?.[name];
  if (raw === undefined) return null;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
}

export function createOpenRouterProvider(apiKey: string): Provider {
  const openrouter = createOpenRouter({ apiKey });
  return {
    id: 'openrouter',
    name: 'OpenRouter',
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
        // Usage accounting makes OpenRouter report each step's exact cost.
        model: openrouter.chat(modelId, { usage: { include: true } }),
        messages,
        tools,
        stopWhen: stepCountIs(MAX_TOOL_STEPS),
        prepareStep: prepareStepFor(beforeStep, (id) => openrouter.chat(id, { usage: { include: true } })),
        abortSignal,
        // The library prints every failure to the screen by default, over Jeeves's
        // window; the failure still arrives below and is explained in plain English.
        onError: () => {},
        providerOptions: {
          openrouter: {
            session_id: stickySessionId,
          },
        },
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
      const reasoning = finalStep.reasoningText ?? '';
      const responseMessages = await result.responseMessages;
      const usage = await result.usage;

      const headers = finalStep.response.headers;
      const limit = headerNumber(headers, 'x-ratelimit-limit');
      const remaining = headerNumber(headers, 'x-ratelimit-remaining');
      const reset = headerNumber(headers, 'x-ratelimit-reset');
      const rateLimit: RateLimitInfo | null =
        limit !== null || remaining !== null
          ? { limit: limit ?? 0, remaining: remaining ?? 0, reset: reset ?? 0 }
          : null;

      return {
        text,
        reasoning,
        messages: responseMessages,
        usage: {
          input: usage.inputTokens ?? 0,
          output: usage.outputTokens ?? 0,
          total: usage.totalTokens ?? 0,
          cached: usage.inputTokenDetails?.cacheReadTokens ?? 0,
        },
        cost: 0,
        rateLimit,
        stepCosts: (await result.steps).map(stepCost),
      };
    },
  };
}