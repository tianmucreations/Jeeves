import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { pkcePair, authorizeUrl, signInWithOpenRouter } from '../src/providers/openrouter-signin.js';

describe('Sign in with OpenRouter', () => {
  it('makes the challenge exactly as OpenRouter documents: base64url of SHA-256 of the verifier', () => {
    const { verifier, challenge } = pkcePair();
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'));
    expect(verifier.length).toBeGreaterThanOrEqual(43);
  });

  it('asks OpenRouter with a local callback, the challenge, S256 and the name Jeeves', () => {
    const url = new URL(authorizeUrl('http://localhost:5555/callback', 'abc'));
    expect(url.origin + url.pathname).toBe('https://openrouter.ai/auth');
    expect(Object.fromEntries(url.searchParams)).toEqual({ callback_url: 'http://localhost:5555/callback', code_challenge: 'abc', code_challenge_method: 'S256', key_label: 'Jeeves' });
  });

  it('when the person approves, exchanges the code with the verifier and returns their key', async () => {
    let sent: Record<string, unknown> = {};
    const result = await signInWithOpenRouter({
      // A pretend browser: OpenRouter sends it back to the callback with a code.
      open: (url) => {
        const callback = new URL(new URL(url).searchParams.get('callback_url')!);
        void fetch(`http://127.0.0.1:${callback.port}/callback?code=the-code`);
      },
      exchange: async (body) => {
        sent = body as Record<string, unknown>;
        return new Response(JSON.stringify({ key: 'sk-or-v1-user-key' }), { status: 200 });
      },
    });
    expect(result).toEqual({ ok: true, key: 'sk-or-v1-user-key' });
    expect(sent.code).toBe('the-code');
    expect(sent.code_challenge_method).toBe('S256');
    expect(typeof sent.code_verifier).toBe('string');
  });

  it('says so when OpenRouter refuses, when nobody approves in time, and when cancelled', async () => {
    const refuse = await signInWithOpenRouter({
      open: (url) => void fetch(`http://127.0.0.1:${new URL(new URL(url).searchParams.get('callback_url')!).port}/callback?code=x`),
      exchange: async () => new Response('{}', { status: 400 }),
    });
    expect(refuse).toEqual({ ok: false, reason: 'refused' });
    expect(await signInWithOpenRouter({ open: () => {}, timeoutMs: 50 })).toEqual({ ok: false, reason: 'timeout' });
    const controller = new AbortController();
    const pending = signInWithOpenRouter({ signal: controller.signal, open: () => controller.abort() });
    const early = new AbortController();
    early.abort();
    expect(await signInWithOpenRouter({ signal: early.signal, open: () => {} })).toEqual({ ok: false, reason: 'cancelled' });
    expect(await pending).toEqual({ ok: false, reason: 'cancelled' });
  });
});
