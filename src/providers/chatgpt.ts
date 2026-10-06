import { createServer } from 'node:http';
import { createOpenAI } from '@ai-sdk/openai';
import type { LanguageModel } from 'ai';
import { pkcePair, openInBrowser } from './openrouter-signin.js';

// "Sign in with ChatGPT": use the ChatGPT Plus or Pro plan the person already pays for, instead
// of a key and a per-use bill. Copied from OpenCode (packages/opencode/src/plugin/openai/codex.ts,
// read 30 Sept 2026): OpenAI's public Codex sign-in - the browser approves, a localhost page
// receives the answer (port 1455, the address OpenAI registered for this sign-in), the tokens are
// refreshed as they expire, and requests go to ChatGPT's own Codex address with the account's id.
// Cline offers the same; OpenAI's Codex docs (developers.openai.com/codex/auth) describe it and no
// rule against other apps was found (30 Sept). NOT yet tried against a real ChatGPT account.
export const CHATGPT_ID = 'chatgpt';

const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann';
const ISSUER = 'https://auth.openai.com';
// Where requests go. Practice runs can point this at a pretend service (bench/fake-codex.mts).
export const CODEX_ENDPOINT = process.env.NODE_ENV === 'test' && process.env.JEEVES_CHATGPT_ENDPOINT ? process.env.JEEVES_CHATGPT_ENDPOINT : 'https://chatgpt.com/backend-api/codex/responses';
// OpenAI's own Codex app (codex-rs/login/src/server.rs, read 30 Sept 2026) listens on port 1455
// and, if that is busy, on 1457 - the two addresses OpenAI has registered for this sign-in, both
// written 127.0.0.1 (this computer, and only this computer).
export const CALLBACK_PORT = 1455;
export const FALLBACK_PORT = 1457;
const redirectFor = (port: number) => `http://127.0.0.1:${port}/auth/callback`;

export interface ChatGptTokens {
  access: string;
  refresh: string;
  // When the access token stops working, in ms since 1970.
  expires: number;
  accountId?: string;
}

interface TokenReply {
  id_token?: string;
  access_token: string;
  refresh_token: string;
  expires_in?: number;
}

function claimsOf(token: string): Record<string, any> | undefined {
  const parts = token.split('.');
  if (parts.length !== 3) return undefined;
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString());
  } catch {
    return undefined;
  }
}

export function accountIdFrom(reply: Pick<TokenReply, 'id_token' | 'access_token'>): string | undefined {
  for (const token of [reply.id_token, reply.access_token]) {
    if (!token) continue;
    const claims = claimsOf(token);
    const id = claims?.chatgpt_account_id ?? claims?.['https://api.openai.com/auth']?.chatgpt_account_id ?? claims?.organizations?.[0]?.id;
    if (id) return id;
  }
  return undefined;
}

export function authorizeUrl(challenge: string, state: string, port = CALLBACK_PORT): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: redirectFor(port),
    scope: 'openid profile email offline_access',
    code_challenge: challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'jeeves',
  });
  return `${ISSUER}/oauth/authorize?${params.toString()}`;
}

function tokensFrom(reply: TokenReply, previousAccount?: string): ChatGptTokens {
  return {
    access: reply.access_token,
    refresh: reply.refresh_token,
    expires: Date.now() + (reply.expires_in ?? 3600) * 1000,
    accountId: accountIdFrom(reply) ?? previousAccount,
  };
}

async function tokenRequest(body: Record<string, string>, post = fetch): Promise<TokenReply> {
  const response = await post(`${ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ ...body, client_id: CLIENT_ID }).toString(),
  });
  if (!response.ok) throw new Error(`ChatGPT sign-in answered ${response.status}`);
  return (await response.json()) as TokenReply;
}

export async function refreshTokens(current: ChatGptTokens, post = fetch): Promise<ChatGptTokens> {
  return tokensFrom(await tokenRequest({ grant_type: 'refresh_token', refresh_token: current.refresh }, post), current.accountId);
}

export type ChatGptSignIn = { ok: true; tokens: ChatGptTokens } | { ok: false; reason: 'timeout' | 'cancelled' | 'refused' | 'busy' };

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Jeeves</title><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0b0b0d;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:500">Jeeves</h1><p>${message}</p></div>`;

// The browser flow. The person logs in to ChatGPT in their browser and clicks to allow; the page
// they land on tells them to go back to Jeeves. Only this computer can reach that page, and
// only with the secret code (state) made for this attempt.
export async function signInWithChatGpt(options: {
  open?: (url: string) => void;
  onUrl?: (url: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  post?: typeof fetch;
  // Ports to try, in order (the real ones by default; checks use their own).
  ports?: number[];
}): Promise<ChatGptSignIn> {
  const { verifier, challenge } = pkcePair();
  const state = pkcePair().verifier;
  return new Promise<ChatGptSignIn>((resolve) => {
    let settled = false;
    let activePort = CALLBACK_PORT;
    const server = createServer((request, response) => {
      const url = new URL(request.url ?? '/', `http://127.0.0.1:${activePort}`);
      if (url.pathname !== '/auth/callback') {
        response.writeHead(404).end();
        return;
      }
      const code = url.searchParams.get('code');
      if (url.searchParams.get('error') || !code || url.searchParams.get('state') !== state) {
        response.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE("ChatGPT didn't complete the sign-in. Go back to Jeeves and try again."));
        finish({ ok: false, reason: 'refused' });
        return;
      }
      tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: redirectFor(activePort), code_verifier: verifier }, options.post)
        .then((reply) => {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE('Jeeves is connected to ChatGPT. You can close this tab and go back to Jeeves.'));
          finish({ ok: true, tokens: tokensFrom(reply) });
        })
        .catch(() => {
          response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE("ChatGPT didn't complete the sign-in. Go back to Jeeves and try again."));
          finish({ ok: false, reason: 'refused' });
        });
    });
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), options.timeoutMs ?? 5 * 60_000);
    const onAbort = () => finish({ ok: false, reason: 'cancelled' });
    options.signal?.addEventListener('abort', onAbort);
    function finish(result: ChatGptSignIn) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      server.close();
      resolve(result);
    }
    if (options.signal?.aborted) return finish({ ok: false, reason: 'cancelled' });
    // Another program (the Codex app) may be using the port: said plainly, not a crash.
    const ports = [...(options.ports ?? [CALLBACK_PORT, FALLBACK_PORT])];
    const tryNext = () => {
      const port = ports.shift();
      if (port === undefined) return finish({ ok: false, reason: 'busy' });
      activePort = port;
      server.once('error', tryNext);
      server.listen(port, '127.0.0.1', () => {
        server.removeListener('error', tryNext);
        const url = authorizeUrl(challenge, state, port);
        options.onUrl?.(url);
        (options.open ?? openInBrowser)(url);
      });
    };
    tryNext();
  });
}

export const CHATGPT_WAITING_STEPS = [
  'Your browser has opened at ChatGPT.',
  'Log in if it asks, then click to allow Jeeves.',
  "I'm waiting here - this moves on by itself once you approve.",
];

// --- Using the plan -------------------------------------------------------------------------

// The models the ChatGPT plan offers (OpenCode's list: gpt-5.5 and later, not the "pro" ones).
export function chatGptModelAllowed(id: string): boolean {
  if (/pro$/.test(id) || id === 'gpt-5.6') return false;
  const match = id.match(/^gpt-(\d+)(?:\.(\d+))?/);
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2] ?? 0);
  return major > 5 || (major === 5 && minor >= 4);
}

// A stand-in for fetch that signs each request with the person's plan, renews the token when it
// has run out (saving the new one), and sends the request to ChatGPT's Codex address.
export function chatGptFetch(store: { get(): ChatGptTokens | null; set(tokens: ChatGptTokens): Promise<void> | void }, base: typeof fetch = fetch): typeof fetch {
  let refreshing: Promise<ChatGptTokens> | null = null;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    let tokens = store.get();
    if (!tokens) throw new Error('ChatGPT is not signed in - click Settings to sign in.');
    if (!tokens.access || tokens.expires < Date.now() + 30_000) {
      refreshing ??= refreshTokens(tokens, base)
        .then(async (fresh) => {
          await store.set(fresh);
          return fresh;
        })
        .finally(() => {
          refreshing = null;
        });
      tokens = await refreshing;
    }
    const headers = new Headers(init?.headers);
    headers.set('authorization', `Bearer ${tokens.access}`);
    if (tokens.accountId) headers.set('ChatGPT-Account-Id', tokens.accountId);
    const asked = input instanceof URL ? input : new URL(typeof input === 'string' ? input : (input as Request).url);
    const toCodex = asked.pathname.includes('/v1/responses') || asked.pathname.includes('/chat/completions') || asked.pathname.endsWith('/responses');
    return base(toCodex ? new URL(CODEX_ENDPOINT) : asked, { ...init, headers });
  }) as typeof fetch;
}

export function chatGptModelFactory(store: Parameters<typeof chatGptFetch>[0], base?: typeof fetch): (modelId: string) => LanguageModel {
  const client = createOpenAI({ apiKey: 'signed-in-with-chatgpt', fetch: chatGptFetch(store, base) });
  return (id) => client.responses(id);
}

// Where the signed-in tokens live: the same key store as every other credential (the keychain),
// wired in by providers/index.ts so this file stays free of it.
type TokenStore = Parameters<typeof chatGptFetch>[0];
let tokenStore: TokenStore = { get: () => null, set: () => {} };
export function registerChatGptStore(store: TokenStore): void {
  tokenStore = store;
}
export function currentChatGptStore(): TokenStore {
  return tokenStore;
}

export function parseTokens(saved: string | null | undefined): ChatGptTokens | null {
  if (!saved) return null;
  try {
    const value = JSON.parse(saved) as Partial<ChatGptTokens>;
    return typeof value.refresh === 'string' && typeof value.access === 'string' ? (value as ChatGptTokens) : null;
  } catch {
    return null;
  }
}
