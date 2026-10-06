import { createHash, randomBytes } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';

// "Sign in with OpenRouter": the person approves Jeeves in their browser and
// OpenRouter hands back a key on their own account - nothing to copy or paste, the
// step that stops most non-coders. OpenRouter's OAuth PKCE flow, as documented at
// openrouter.ai/docs/use-cases/oauth-pkce (checked 18 Sept 2026): open
// https://openrouter.ai/auth with callback_url, code_challenge (base64url of the
// SHA-256 of a random verifier) and code_challenge_method=S256; the browser returns
// to the callback with ?code=; POST {code, code_verifier, code_challenge_method} to
// /api/v1/auth/keys and read "key". Localhost callbacks on any port are allowed.

export const AUTH_URL = 'https://openrouter.ai/auth';
export const EXCHANGE_URL = 'https://openrouter.ai/api/v1/auth/keys';

export type SignInResult = { ok: true; key: string } | { ok: false; reason: 'timeout' | 'cancelled' | 'refused' };

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function authorizeUrl(callbackUrl: string, challenge: string): string {
  const params = new URLSearchParams({ callback_url: callbackUrl, code_challenge: challenge, code_challenge_method: 'S256', key_label: 'Jeeves' });
  return `${AUTH_URL}?${params.toString()}`;
}

// The program and arguments that open a web address on each system.
export function browserCommand(url: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  // Windows: rundll32, as Claude Code does (utils/browser.ts) - never cmd's "start",
  // which splits a web address at its & signs (audit, 19 Sept).
  return platform === 'darwin' ? ['open', [url]] : platform === 'win32' ? ['rundll32', ['url,OpenURL', url]] : ['xdg-open', [url]];
}

// Opens the address in the person's own browser, on every operating system.
export function openInBrowser(url: string): void {
  const command = browserCommand(url);
  try {
    const child = spawn(command[0] as string, command[1] as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {});
    child.unref();
  } catch {
    // The address is also shown on screen, so the person can open it themselves.
  }
}

const PAGE = (message: string) =>
  `<!doctype html><meta charset="utf-8"><title>Jeeves</title><body style="font-family:-apple-system,Segoe UI,sans-serif;background:#0b0b0d;color:#e6e6e6;display:grid;place-items:center;height:100vh;margin:0"><div style="text-align:center"><h1 style="font-weight:500">Jeeves</h1><p>${message}</p></div>`;

export async function signInWithOpenRouter(options: {
  open?: (url: string) => void;
  onUrl?: (url: string) => void;
  signal?: AbortSignal;
  timeoutMs?: number;
  exchange?: (body: object) => Promise<Response>;
}): Promise<SignInResult> {
  const { verifier, challenge } = pkcePair();
  const exchange = options.exchange ?? ((body: object) => fetch(EXCHANGE_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
  return new Promise<SignInResult>((resolve) => {
    let settled = false;
    const server = createServer(async (request, response) => {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const code = url.searchParams.get('code');
      if (url.pathname !== '/callback' || !code) {
        response.writeHead(404).end();
        return;
      }
      try {
        const reply = await exchange({ code, code_verifier: verifier, code_challenge_method: 'S256' });
        const body = (await reply.json().catch(() => ({}))) as { key?: unknown };
        if (!reply.ok || typeof body.key !== 'string') throw new Error(`exchange ${reply.status}`);
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE('Jeeves is connected to OpenRouter. You can close this tab and go back to Jeeves.'));
        finish({ ok: true, key: body.key });
      } catch {
        response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(PAGE("OpenRouter didn't complete the sign-in. Go back to Jeeves and try again."));
        finish({ ok: false, reason: 'refused' });
      }
    });
    // Fifteen minutes: long enough to make a new OpenRouter account and confirm an email.
    const timer = setTimeout(() => finish({ ok: false, reason: 'timeout' }), options.timeoutMs ?? 15 * 60_000);
    const onAbort = () => finish({ ok: false, reason: 'cancelled' });
    options.signal?.addEventListener('abort', onAbort);
    if (options.signal?.aborted) {
      finish({ ok: false, reason: 'cancelled' });
      return;
    }
    function finish(result: SignInResult) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener('abort', onAbort);
      server.close();
      resolve(result);
    }
    // Only this computer can reach the callback.
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      const url = authorizeUrl(`http://localhost:${port}/callback`, challenge);
      options.onUrl?.(url);
      (options.open ?? openInBrowser)(url);
    });
  });
}

// Said while the browser is open, in the terminal and the window alike. A person
// who is not logged in lands on OpenRouter's Sign Up page, which carries a return
// address to this same approval page (measured 19 Sept with a logged-out visit).
export const WAITING_STEPS = [
  'Your browser has opened at OpenRouter.',
  'Log in if it asks, then click Authorize.',
  'New to OpenRouter? Make an account on the page that opens - it brings you back to Authorize afterwards. If you end up somewhere else, come back here and choose Sign in again.',
  "I'm waiting here - this moves on by itself once you approve.",
];
