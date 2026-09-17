import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/providers/index.js', () => ({ getOpenRouterKey: () => 'sk-or-test' }));

const { htmlToText, decodeEntities } = await import('../src/tools/web/htmlToText.js');
const research = await import('../src/tools/web/research.js');
const { session } = await import('../src/state/session.js');

type Handler = (url: string, init?: RequestInit) => { status?: number; json?: unknown; text?: string; type?: string };

function mockFetch(handler: Handler) {
  const calls: { url: string; body: any }[] = [];
  vi.stubGlobal('fetch', vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : null });
    const out = handler(url, init);
    const status = out.status ?? 200;
    const body = out.json !== undefined ? JSON.stringify(out.json) : out.text ?? '';
    return new Response(body, { status, headers: { 'content-type': out.type ?? (out.json !== undefined ? 'application/json' : 'text/html') } });
  }));
  return calls;
}

const citationReply = (url: string) => ({ choices: [{ message: { content: '', annotations: [{ type: 'url_citation', url_citation: { url, title: 'T', content: 'snippet text' } }] } }] });
const textReply = (content: string) => ({ choices: [{ message: { content } }] });

beforeEach(() => {
  vi.unstubAllGlobals();
  session.providerId = 'openrouter';
  session.model = 'deepseek/deepseek-v4-flash-0731';
});

describe('page text', () => {
  it('drops scripts and styles, keeps the words, decodes entities', () => {
    const html = '<html><head><title>Node &amp; Co</title><style>x{}</style></head><body><script>evil()</script><h1>Releases</h1><p>v24.21.0&nbsp;LTS &#8212; Krypton</p><ul><li>One</li><li>Two</li></ul></body></html>';
    const text = htmlToText(html);
    expect(text).toContain('Node & Co');
    expect(text).toContain('Releases\n');
    expect(text).toContain('v24.21.0 LTS — Krypton');
    expect(text).not.toContain('evil');
    expect(text).not.toContain('x{}');
    expect(decodeEntities('&#x41;&lt;&unknown;')).toBe('A<&unknown;');
  });
});

describe('web search rotation', () => {
  it('moves to the next engine when one fails, and returns its results', async () => {
    const calls = mockFetch((_url, init) => {
      const engine = JSON.parse(String(init!.body)).plugins[0].engine;
      return engine === 'exa' ? { status: 503, json: { error: { message: 'exa down' } } } : { json: citationReply('https://nodejs.org/en/about/previous-releases') };
    });
    const out = await research.runWebSearch({ query: 'node lts' });
    expect(calls.map((c) => c.body.plugins[0].engine)).toEqual(['exa', 'parallel']);
    expect(out).toContain('https://nodejs.org/en/about/previous-releases');
    expect(out).toContain('not checked facts');
  });

  it('stops at once on a rejected key or empty credit instead of burning through engines', async () => {
    const calls = mockFetch(() => ({ status: 402, json: { error: { message: 'Insufficient credits' } } }));
    await expect(research.runWebSearch({ query: 'x' })).rejects.toThrow('Insufficient credits');
    expect(calls.length).toBe(1);
  });

  it('says plainly when every engine fails', async () => {
    mockFetch(() => ({ status: 500, json: { error: { message: 'boom' } } }));
    await expect(research.runWebSearch({ query: 'x' })).rejects.toThrow('Web search is not available right now');
  });
});

describe('reading a page', () => {
  it('opens the page itself and has the cheap model quote it', async () => {
    const calls = mockFetch((url) =>
      url.startsWith('https://nodejs.org') ? { text: '<p>Latest LTS: v24.21.0 (Krypton)</p>' + ' filler'.repeat(20) } : { json: textReply('v24.21.0 - "Latest LTS: v24.21.0"') }
    );
    const out = await research.runReadWebPage({ url: 'https://nodejs.org/en', question: 'latest LTS?' });
    expect(out).toContain('"Latest LTS: v24.21.0"');
    expect(out).toContain('Source: https://nodejs.org/en');
    const reading = calls.find((c) => c.url.includes('openrouter'))!;
    expect(reading.body.model).toBe('deepseek/deepseek-v4-flash-0731');
    expect(reading.body.messages[1].content).toContain('Latest LTS: v24.21.0');
  });

  it('falls back to search excerpts from that site when the page refuses', async () => {
    const calls = mockFetch((url, init) => {
      if (url.startsWith('https://example.com')) return { status: 403, text: 'forbidden' };
      const body = JSON.parse(String(init!.body));
      return body.plugins ? { json: citationReply('https://example.com/page') } : { json: textReply('answer "quote"') };
    });
    const out = await research.runReadWebPage({ url: 'https://example.com/page', question: 'q' });
    expect(calls.find((c) => c.body?.plugins)?.body.plugins[0].include_domains).toEqual(['example.com']);
    expect(out).toContain('search excerpts from example.com');
  });

  it("rotates to Jeeves's own model, then to the page text itself", async () => {
    session.model = 'z-ai/glm-5.3';
    const calls = mockFetch((url) => (url.startsWith('https://site.test') ? { text: 'The answer is 42.'.repeat(5), type: 'text/plain' } : { status: 404, json: { error: { message: 'model gone' } } }));
    const out = await research.runReadWebPage({ url: 'https://site.test/a', question: 'q' });
    expect(calls.filter((c) => c.url.includes('openrouter')).map((c) => c.body.model)).toEqual(['deepseek/deepseek-v4-flash-0731', 'z-ai/glm-5.3']);
    expect(out).toContain('The reading model was unavailable');
    expect(out).toContain('The answer is 42.');
  });

  it('refuses anything that is not a web address', async () => {
    await expect(research.runReadWebPage({ url: 'file:///etc/passwd', question: 'q' })).rejects.toThrow('Only web pages');
    await expect(research.runReadWebPage({ url: 'not a url', question: 'q' })).rejects.toThrow('not a valid web address');
  });
});
