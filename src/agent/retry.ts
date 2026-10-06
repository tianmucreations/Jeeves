import { session } from '../state/session.js';
import { plainError } from './errors.js';

// OpenCode's retry policy (session/retry.ts), Jeeves-sized: a request that fails
// for a temporary reason - asked to slow down, a bad server, a dropped connection
// - is retried automatically, up to five tries, before ever bothering the person.
// It waits exactly as long as the service asks (the Retry-After answer header)
// and otherwise backs off exponentially with a little randomness, so everyone
// doesn't retry at once. Anything that is not temporary - a bad key, no credit,
// an over-long conversation, a vanished model - is thrown straight through,
// unchanged, and never retried.
const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 2_000;
const MAX_DELAY_MS = 30_000;
const JITTER = 0.25;

const RETRYABLE_KINDS = new Set(['rate-limit', 'network']);

function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      resolve();
    }, { once: true });
  });
}

// The service's own answer to "how long?": the Retry-After header, in seconds or
// as a date. Kept between one second and one minute - the person waits, not the
// other way round.
function retryAfterMs(error: unknown): number | null {
  const carrier = error as { headers?: Record<string, unknown>; responseHeaders?: Record<string, unknown> } | null;
  const raw = carrier?.headers?.['retry-after'] ?? carrier?.responseHeaders?.['retry-after'];
  if (typeof raw !== 'string' && typeof raw !== 'number') return null;
  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.min(Math.max(seconds * 1000, 1_000), 60_000);
  if (typeof raw === 'string') {
    const when = Date.parse(raw);
    if (!Number.isNaN(when)) return Math.min(Math.max(when - Date.now(), 1_000), 60_000);
  }
  return null;
}

function backoffMs(attempt: number): number {
  const base = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  return Math.round(base * (1 - JITTER + Math.random() * 2 * JITTER));
}

export async function withRateLimitRetry<T>(
  run: () => Promise<T>,
  providerId: string | undefined,
  signal: AbortSignal,
  onRetry?: () => void,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (signal.aborted || attempt >= MAX_ATTEMPTS - 1) throw error;
      const plain = plainError(error, providerId);
      if (!RETRYABLE_KINDS.has(plain.kind)) throw error;
      const delay = retryAfterMs(error) ?? backoffMs(attempt + 1);
      const reason = plain.kind === 'rate-limit' ? 'asked to slow down' : 'the service stumbled';
      session.setBusyNote(`retrying in ${Math.max(1, Math.round(delay / 1000))}s (try ${attempt + 2} of ${MAX_ATTEMPTS}) - ${reason}…`);
      onRetry?.();
      await wait(delay, signal);
      session.setBusyNote(null);
      if (signal.aborted) throw error;
    }
  }
}
