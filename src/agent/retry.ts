import { session } from '../state/session.js';
import { plainError } from './errors.js';

// Free models get rate-limited far more often than paid ones. Jeeves used to show
// "asking us to slow down" once and stop, so asking again straight away just hit the
// same limit - this retries automatically, waiting between tries, before ever
// bothering the person with it. Only a recognised rate limit is worth retrying blind;
// anything else (a bad key, no credit, a genuinely broken request) is thrown straight
// through, unchanged.
const RETRY_DELAYS_MS = [4_000, 12_000];

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

export async function withRateLimitRetry<T>(run: () => Promise<T>, providerId: string | undefined, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await run();
    } catch (error) {
      if (signal.aborted || attempt >= RETRY_DELAYS_MS.length) throw error;
      const plain = plainError(error, providerId);
      if (plain.kind !== 'rate-limit') throw error;
      session.setBusyNote('waiting a few seconds - asked to slow down, trying again shortly…');
      await wait(RETRY_DELAYS_MS[attempt], signal);
      session.setBusyNote(null);
      if (signal.aborted) throw error;
    }
  }
}
