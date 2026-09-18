import type { Citation } from './openrouterChat.js';
import { ZAI_CODING_BASE_URL } from '../../providers/zai.js';

// Web search on the GLM Coding Plan: Z.ai's Web Search MCP server, included in every
// plan (docs.z.ai/devpack/mcp/search-mcp-server). Spoken to directly over MCP's HTTP
// transport: initialize, then call the one tool it lists, "web_search_prime".
// Measured 18 Sept 2026 with a real plan key: results come back as a JSON string of
// [{title, link, content, refer}], where link is often only the site's front page and
// content a ~150-character summary - weaker than OpenRouter's search, so Jeeves is told
// to say plainly when a fact can't be confirmed from them.

export const ZAI_SEARCH_URL = 'https://api.z.ai/api/mcp/web_search_prime/mcp';

interface RpcReply {
  session?: string;
  body: { result?: { content?: { type: string; text?: string }[]; isError?: boolean }; error?: { message?: string } };
}

async function rpc(key: string, body: object, session: string | undefined, signal: AbortSignal): Promise<RpcReply> {
  const response = await fetch(ZAI_SEARCH_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      ...(session ? { 'mcp-session-id': session } : {}),
    },
    body: JSON.stringify(body),
    signal,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Z.ai web search returned ${response.status}: ${text.slice(0, 200)}`);
  // Replies arrive as server-sent events ("data: {...}") or as plain JSON.
  const line = text.split('\n').find((entry) => entry.startsWith('data:'));
  const parsed = line ? JSON.parse(line.slice(5)) : text ? JSON.parse(text) : {};
  return { session: response.headers.get('mcp-session-id') ?? session, body: parsed };
}

// The tool's text is a JSON string of the results (sometimes JSON-encoded twice).
export function parseZaiResults(text: string): Citation[] {
  let value: unknown = text;
  for (let i = 0; i < 2 && typeof value === 'string'; i++) {
    try {
      value = JSON.parse(value);
    } catch {
      break;
    }
  }
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => item as { link?: unknown; title?: unknown; content?: unknown })
    .filter((item) => typeof item.link === 'string' && item.link)
    .map((item) => ({ url: String(item.link), title: String(item.title ?? ''), content: String(item.content ?? '') }));
}

export async function zaiSearch(key: string, query: string, site?: string, timeoutMs = 45_000): Promise<Citation[]> {
  const signal = AbortSignal.timeout(timeoutMs);
  const init = await rpc(key, { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'jeeves', version: '1' } } }, undefined, signal);
  // The server expects to be told initialisation is finished before tool calls.
  await rpc(key, { jsonrpc: '2.0', method: 'notifications/initialized' }, init.session, signal).catch(() => undefined);
  const call = await rpc(
    key,
    {
      jsonrpc: '2.0',
      id: 2,
      method: 'tools/call',
      params: { name: 'web_search_prime', arguments: { search_query: query.slice(0, 70), location: 'us', ...(site ? { search_domain_filter: site } : {}) } },
    },
    init.session,
    signal
  );
  if (call.body.error || call.body.result?.isError) {
    throw new Error(`Z.ai web search: ${call.body.error?.message ?? call.body.result?.content?.[0]?.text ?? 'failed'}`);
  }
  return parseZaiResults(call.body.result?.content?.find((part) => part.type === 'text')?.text ?? '');
}

// One reading request on the plan: GLM-5.3-Flash on the coding endpoint, thinking off
// (reading only quotes the page). Returns the reply text.
export const ZAI_READING_MODEL = 'glm-5.3-flash';

export async function zaiRead(key: string, messages: { role: 'system' | 'user'; content: string }[], timeoutMs = 60_000): Promise<string> {
  const response = await fetch(`${ZAI_CODING_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ZAI_READING_MODEL, messages, max_tokens: 1500, thinking: { type: 'disabled' } }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`Z.ai returned ${response.status}: ${text.slice(0, 200)}`);
  const body = JSON.parse(text) as { choices?: { message?: { content?: string } }[] };
  return (body.choices?.[0]?.message?.content ?? '').trim();
}
