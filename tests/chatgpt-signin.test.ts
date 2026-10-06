import { describe, it, expect } from 'vitest';
import { authorizeUrl, accountIdFrom, signInWithChatGpt, chatGptFetch, chatGptModelAllowed, parseTokens, CODEX_ENDPOINT, type ChatGptTokens } from '../src/providers/chatgpt.js';
import { directModelList, type Catalogue } from '../src/providers/catalogue.js';

const jwt = (claims: object) => `x.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.y`;
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('Sign in with ChatGPT (OpenCode plugin/openai/codex.ts, offline checks)', () => {
  it('builds OpenAI\'s sign-in address the way OpenCode does', () => {
    const url = new URL(authorizeUrl('CHAL', 'STATE'));
    expect(url.origin + url.pathname).toBe('https://auth.openai.com/oauth/authorize');
    expect(url.searchParams.get('client_id')).toBe('app_EMoamEEZ73f0CkXaXp7hrann');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1455/auth/callback');
    expect(new URL(authorizeUrl('C', 'S', 1457)).searchParams.get('redirect_uri')).toBe('http://127.0.0.1:1457/auth/callback');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toBe('openid profile email offline_access');
    expect(url.searchParams.get('state')).toBe('STATE');
  });
  it('finds the account id in the tokens', () => {
    expect(accountIdFrom({ access_token: jwt({ 'https://api.openai.com/auth': { chatgpt_account_id: 'acct_1' } }) })).toBe('acct_1');
    expect(accountIdFrom({ id_token: jwt({ chatgpt_account_id: 'acct_2' }), access_token: 'x' })).toBe('acct_2');
    expect(accountIdFrom({ access_token: 'nonsense' })).toBeUndefined();
  });
  it('the browser comes back, the code is swapped for tokens, and the page tells the person to return', async () => {
    const exchanged: string[] = [];
    const post = (async (_address: string, init?: RequestInit) => {
      exchanged.push(String(init?.body));
      return json({ access_token: jwt({ chatgpt_account_id: 'acct_9' }), refresh_token: 'R1', expires_in: 3600 });
    }) as typeof fetch;
    let url2 = '';
    const port = 45_500 + Math.floor(Math.random() * 400);
    const second = signInWithChatGpt({ open: () => {}, onUrl: (u) => (url2 = u), post, ports: [port] });
    await new Promise((r) => setTimeout(r, 150));
    const state2 = new URL(url2).searchParams.get('state')!;
    const page = await fetch(`http://127.0.0.1:${port}/auth/callback?code=CODE123&state=${state2}`);
    expect(await page.text()).toContain('go back to Jeeves');
    const result = await second;
    expect(result.ok && result.tokens.refresh).toBe('R1');
    expect(result.ok && result.tokens.accountId).toBe('acct_9');
    expect(exchanged[0]).toContain('grant_type=authorization_code');
    expect(exchanged[0]).toContain('code=CODE123');
  }, 10_000);
  it('a wrong secret code or a refusal is not accepted', async () => {
    let url = '';
    const port = 45_900 + Math.floor(Math.random() * 90);
    const attempt = signInWithChatGpt({ open: () => {}, onUrl: (u) => (url = u), post: (async () => json({}, 500)) as typeof fetch, ports: [port] });
    await new Promise((r) => setTimeout(r, 150));
    await fetch(`http://127.0.0.1:${port}/auth/callback?code=X&state=WRONG`);
    expect(await attempt).toEqual({ ok: false, reason: 'refused' });
    void url;
  });
  it('can be cancelled, and says so when the port is busy', async () => {
    const controller = new AbortController();
    const port = 46_100 + Math.floor(Math.random() * 90);
    const waiting = signInWithChatGpt({ open: () => {}, signal: controller.signal, ports: [port] });
    await new Promise((r) => setTimeout(r, 100));
    const busy = await signInWithChatGpt({ open: () => {}, ports: [port], timeoutMs: 500 });
    expect(busy).toEqual({ ok: false, reason: 'busy' });
    controller.abort();
    expect(await waiting).toEqual({ ok: false, reason: 'cancelled' });
  });
  it('signs each request with the plan, renews an expired token and saves it, and goes to the Codex address', async () => {
    let saved: ChatGptTokens | null = null;
    let current: ChatGptTokens | null = { access: 'old', refresh: 'R0', expires: Date.now() - 1000, accountId: 'acct_1' };
    const seen: { url: string; headers: Headers }[] = [];
    const base = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const address = String(input instanceof URL ? input.href : input);
      if (address.includes('/oauth/token')) return json({ access_token: 'new', refresh_token: 'R1', expires_in: 3600 });
      seen.push({ url: address, headers: new Headers(init?.headers) });
      return json({ ok: true });
    }) as typeof fetch;
    const fetcher = chatGptFetch({ get: () => current, set: (t) => { saved = t; current = t; } }, base);
    await fetcher('https://api.openai.com/v1/responses', { method: 'POST', headers: { authorization: 'Bearer dummy' }, body: '{}' });
    expect((saved as ChatGptTokens | null)?.refresh).toBe('R1');
    expect(seen[0].url).toBe(CODEX_ENDPOINT);
    expect(seen[0].headers.get('authorization')).toBe('Bearer new');
    expect(seen[0].headers.get('ChatGPT-Account-Id')).toBe('acct_1');
    // Still valid: no second renewal.
    await fetcher('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' });
    expect(seen).toHaveLength(2);
  });
  it('signed out gives a plain message; saved tokens read back', async () => {
    const fetcher = chatGptFetch({ get: () => null, set: () => {} }, (async () => json({})) as typeof fetch);
    await expect(fetcher('https://api.openai.com/v1/responses')).rejects.toThrow('not signed in');
    expect(parseTokens(JSON.stringify({ access: 'a', refresh: 'r', expires: 1 }))?.refresh).toBe('r');
    expect(parseTokens('nonsense')).toBeNull();
    expect(parseTokens(null)).toBeNull();
  });
  it('offers the plan\'s models only: newer than 5.4, no "pro"; free in the plan', () => {
    expect(['gpt-5.5', 'gpt-5.4', 'gpt-5.4-mini', 'gpt-6-sol'].every(chatGptModelAllowed)).toBe(true);
    expect(['gpt-5.5-pro', 'gpt-5.3-codex', 'gpt-4o', 'o3'].some(chatGptModelAllowed)).toBe(false);
    const catalogue: Catalogue = { openai: [{ id: 'gpt-5.5', name: 'GPT-5.5', released: '2026-01-01', context: 400000, cost: { input: 5, output: 20 } }, { id: 'gpt-4o', name: 'GPT-4o', released: '2024-01-01', context: 128000 }] };
    const list = directModelList('chatgpt', catalogue, null);
    expect(list.map((m) => m.id)).toEqual(['gpt-5.5']);
    expect(list[0].priceLabel).toBe('in your plan');
  });
});

import { openaiRoute, serviceFor, rowFor, hasCredentialsFor, useKeyForThisSession } from '../src/providers/index.js';

describe('OpenAI is one entry, connected by plan or key (as OpenCode lists it)', () => {
  it('the row is connected by either, and runs on the plan when signed in', () => {
    expect(openaiRoute()).toBeNull();
    expect(hasCredentialsFor('openai')).toBe(false);
    useKeyForThisSession('openai', 'sk-test');
    expect(openaiRoute()).toBe('openai');
    expect(serviceFor('openai')).toBe('openai');
    expect(hasCredentialsFor('openai')).toBe(true);
    useKeyForThisSession('chatgpt', JSON.stringify({ access: 'a', refresh: 'r', expires: 1 }));
    expect(openaiRoute()).toBe('chatgpt');
    expect(serviceFor('openai')).toBe('chatgpt');
    expect(rowFor('chatgpt')).toBe('openai');
    expect(serviceFor('anthropic')).toBe('anthropic');
  });
});
