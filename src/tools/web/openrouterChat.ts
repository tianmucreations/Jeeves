import { reportSpend } from '../../agent/spending.js';

// One plain request to OpenRouter's standard chat endpoint (not a beta feature).
// Used by web research for the cheap reading model and for web search.

export interface Citation {
  url: string;
  title: string;
  content: string;
}

export interface ChatReply {
  text: string;
  citations: Citation[];
  // OpenRouter's own figure for what this request cost, in dollars.
  cost: number;
}

export class OpenRouterRequestError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

export async function openrouterChat(
  apiKey: string,
  body: Record<string, unknown>,
  timeoutMs = 60_000
): Promise<ChatReply> {
  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, usage: { include: true } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const json = (await response.json().catch(() => ({}))) as {
    error?: { message?: string };
    usage?: { cost?: number };
    choices?: { message?: { content?: string; annotations?: { type?: string; url_citation?: Partial<Citation> }[] } }[];
  };
  if (!response.ok || json.error) {
    throw new OpenRouterRequestError(json.error?.message ?? `OpenRouter returned ${response.status}`, response.status);
  }
  const message = json.choices?.[0]?.message;
  const citations = (message?.annotations ?? [])
    .filter((annotation) => annotation.type === 'url_citation' && annotation.url_citation?.url)
    .map((annotation) => ({
      url: annotation.url_citation!.url!,
      title: annotation.url_citation!.title ?? '',
      content: annotation.url_citation!.content ?? '',
    }));
  const cost = typeof json.usage?.cost === 'number' ? json.usage.cost : 0;
  reportSpend(cost);
  return { text: (message?.content ?? '').trim(), citations, cost };
}
