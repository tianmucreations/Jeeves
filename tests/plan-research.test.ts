import { describe, it, expect, vi, beforeEach } from 'vitest';

// Research follows the service chosen (owner's rule, 18 Sept): on the Z.ai plan it
// never touches OpenRouter, even with an OpenRouter key saved.
let openRouterKey: string | null = 'sk-or-test';
vi.mock('../src/providers/index.js', () => ({
  getOpenRouterKey: () => openRouterKey,
  getZaiKey: () => 'zai-test',
  serviceKey: () => null,
  PROVIDER_ROWS: [
    { id: 'openrouter', label: 'OpenRouter' },
    { id: 'zai', label: 'Z.ai' },
    { id: 'anthropic', label: 'Anthropic' },
  ],
}));

const research = await import('../src/tools/web/research.js');
const { parseZaiResults, ZAI_SEARCH_URL } = await import('../src/tools/web/zai-search.js');
const { session } = await import('../src/state/session.js');

const zaiResults = [{ title: 'PEP 8', link: 'https://peps.python.org', content: 'Style Guide for Python Code', refer: 'ref_1' }];

function mockFetch() {
  const calls: { url: string; body: any; headers: Record<string, string> }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : null;
    calls.push({ url, body, headers: (init?.headers ?? {}) as Record<string, string> });
    if (url === ZAI_SEARCH_URL) {
      if (body.method === 'initialize') return new Response('data: {"jsonrpc":"2.0","id":1,"result":{}}\n\n', { headers: { 'mcp-session-id': 'S1' } });
      if (body.method === 'tools/call') {
        // As measured: the text is the results JSON-encoded twice.
        const text = JSON.stringify(JSON.stringify(zaiResults));
        return new Response(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 2, result: { content: [{ type: 'text', text }] } })}\n\n`);
      }
      return new Response('', { status: 202 });
    }
    if (url.includes('api.z.ai/api/coding')) return Response.json({ choices: [{ message: { content: 'Four spaces. "Use 4 spaces per indentation level."' } }] });
    if (url.includes('openrouter.ai')) return Response.json({ choices: [{ message: { content: 'from openrouter' } }] });
    return new Response('<html><body><p>Use 4 spaces per indentation level, the page says, at length.</p></body></html>', { headers: { 'content-type': 'text/html' } });
  }));
  return calls;
}

beforeEach(() => {
  vi.unstubAllGlobals();
  openRouterKey = 'sk-or-test';
  research.resetBorrowedSearch();
  session.providerId = 'zai';
  session.model = 'glm-5.3';
});

describe('research on the Z.ai plan', () => {
  it('searches with the plan and never calls OpenRouter, even with an OpenRouter key saved', async () => {
    const calls = mockFetch();
    const out = await research.runWebSearch({ query: 'python indentation' });
    expect(out).toContain('https://peps.python.org');
    expect(calls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
    const call = calls.find((c) => c.body?.method === 'tools/call')!;
    expect(call.body.params).toMatchObject({ name: 'web_search_prime', arguments: { search_query: 'python indentation' } });
    expect(call.headers['mcp-session-id']).toBe('S1');
    expect(call.headers.Authorization).toBe('Bearer zai-test');
  });

  it('reads the page with GLM on the plan, not OpenRouter', async () => {
    const calls = mockFetch();
    const out = await research.runReadWebPage({ url: 'https://peps.python.org/pep-0008/', question: 'indentation?' });
    expect(out).toContain('Four spaces');
    expect(calls.some((c) => c.url.includes('openrouter.ai'))).toBe(false);
    expect(calls.find((c) => c.url.includes('api.z.ai/api/coding'))!.body.model).toBe('glm-5.3-flash');
  });

  it('works with no OpenRouter key at all', async () => {
    openRouterKey = null;
    mockFetch();
    await expect(research.runWebSearch({ query: 'x' })).resolves.toContain('peps.python.org');
  });

  it('reads results that are JSON-encoded once or twice', () => {
    expect(parseZaiResults(JSON.stringify(zaiResults))[0].url).toBe('https://peps.python.org');
    expect(parseZaiResults(JSON.stringify(JSON.stringify(zaiResults)))[0].title).toBe('PEP 8');
    expect(parseZaiResults('not json')).toEqual([]);
  });
});

describe('research on a service with no search of its own', () => {
  beforeEach(() => {
    session.providerId = 'anthropic';
  });

  it('asks before borrowing OpenRouter, once per conversation', async () => {
    expect(research.borrowedSearchNeedsAsking()).toBe(true);
    expect(research.borrowedSearchQuestion()).toContain("isn't available with Anthropic");
    mockFetch();
    await research.runWebSearch({ query: 'x' }).catch(() => undefined);
    expect(research.borrowedSearchNeedsAsking()).toBe(false);
    research.resetBorrowedSearch();
    expect(research.borrowedSearchNeedsAsking()).toBe(true);
  });

  it('never searches OpenRouter behind the scenes without that yes', async () => {
    const calls = mockFetch();
    await expect(research.searchWeb('x')).rejects.toThrow('not allowed');
    expect(calls.length).toBe(0);
  });

  it('says plainly that search is unavailable when there is no OpenRouter key', async () => {
    openRouterKey = null;
    expect(research.borrowedSearchNeedsAsking()).toBe(false);
    await expect(research.searchWeb('x')).rejects.toThrow("isn't available with Anthropic yet");
  });
});
