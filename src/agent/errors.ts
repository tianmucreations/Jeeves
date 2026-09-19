import { directService, serviceNameFor, CUSTOM_SERVICE_ID } from '../providers/direct-services.js';
import { getCustomService } from '../platform/config.js';

export type ErrorKind = 'auth' | 'payment' | 'rate-limit' | 'network' | 'model' | 'context' | 'other';

export interface PlainError {
  message: string;
  kind: ErrorKind;
  // The original technical text, shown only when /verbose is on.
  detail: string;
  // For a used-up flat-rate plan: the reset time it gave (HH:MM), or '' if none.
  resetAt?: string;
}

// The AI service's name as the user knows it, for messages that name it.
function serviceName(providerId: string | undefined): string {
  if (providerId === 'zai') return 'Z.ai';
  if (providerId === 'ollama') return 'Ollama';
  if (providerId === CUSTOM_SERVICE_ID) {
    const saved = getCustomService();
    return saved ? serviceNameFor(saved.baseURL) : 'The service';
  }
  const direct = providerId ? directService(providerId) : undefined;
  if (direct) return direct.label;
  return 'OpenRouter';
}

// Turns technical failures into plain English (Phase 9 polish). Nothing technical
// reaches the screen: unrecognised failures get a plain sentence, and the raw text
// travels in detail for /verbose.
// The HTTP status of a failed request. The AI SDK puts it on the error itself, or on
// lastError once its retries give up; the message text alone often doesn't say it
// (a bad OpenRouter key reads just "User not found.", measured live).
export function statusOf(error: unknown): number | null {
  const candidates = [error, (error as { lastError?: unknown } | null)?.lastError];
  for (const candidate of candidates) {
    const code = (candidate as { statusCode?: unknown } | null)?.statusCode;
    if (typeof code === 'number') return code;
  }
  return null;
}

export function plainError(error: unknown, providerId?: string): PlainError {
  const raw = error instanceof Error ? error.message : String(error);
  const status = statusOf(error);
  const text = raw.toLowerCase();
  const service = serviceName(providerId);
  const make = (message: string, kind: ErrorKind): PlainError => ({ message, kind, detail: raw });

  if (/^no .*\bkey\b/.test(text)) {
    return make('Jeeves isn\'t connected to an AI service yet - type /keys to connect one. It takes about a minute.', 'auth');
  }
  if (
    status === 401 ||
    status === 403 ||
    text.includes('401') ||
    text.includes('unauthorized') ||
    text.includes('invalid api key') ||
    // Google answers 400 "API key not valid"; OpenAI "Incorrect API key provided";
    // Anthropic "invalid x-api-key".
    text.includes('api key not valid') ||
    text.includes('incorrect api key') ||
    text.includes('invalid x-api-key') ||
    text.includes('not authenticated') ||
    text.includes('authentication failed') ||
    text.includes('user not found')
  ) {
    return make(`${service} didn't accept the key - type /keys to check or replace it.`, 'auth');
  }
  // Z.ai's flat plan reports its time window as "Usage limit reached for 5 hour.
  // Your limit will reset at 2026-09-17 13:03:01" (seen in a real session). The
  // reset time is repeated exactly as Z.ai gave it - its time zone is not stated.
  if (text.includes('usage limit')) {
    const reset = raw.match(/reset at \d{4}-\d{2}-\d{2} (\d{2}:\d{2})/i);
    const when = reset ? ` Z.ai says it resets at ${reset[1]}.` : '';
    return {
      ...make(`Your ${service} plan has used up its allowance for now.${when} Type /model to use a different model meanwhile.`, 'payment'),
      resetAt: reset ? reset[1] : '',
    };
  }
  if (
    status === 402 ||
    text.includes('402') ||
    text.includes('insufficient') ||
    text.includes('out of credit') ||
    text.includes('quota') ||
    // Anthropic: "Your credit balance is too low to access the Anthropic API".
    text.includes('credit balance')
  ) {
    const topUp = service === 'OpenRouter' ? 'top up at openrouter.ai/credits' : `add credit on the ${service} website`;
    return make(`${service} credit ran out - ${topUp}, then ask again.`, 'payment');
  }
  if (status === 429 || text.includes('429') || text.includes('rate limit') || text.includes('rate_limit') || text.includes('too many requests')) {
    return make(`${service} is asking us to slow down - wait a few seconds and ask again.`, 'rate-limit');
  }
  const name = (error as { name?: unknown } | null)?.name;
  if (name === 'TimeoutError' || text.includes('timed out') || text.includes('timeout')) {
    return make(`${service} stopped responding partway through - please ask again.`, 'network');
  }
  if (
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('enotfound') ||
    text.includes('econnrefused') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('eai_again') ||
    text.includes('socket hang up')
  ) {
    return make(`Couldn't reach ${service} - check the internet connection and ask again in a moment.`, 'network');
  }
  if ((status === 404 || text.includes('404') || text.includes('not found')) && text.includes('model')) {
    return make("That model isn't available any more - type /model to pick another.", 'model');
  }
  if (text.includes('context') && (text.includes('length') || text.includes('too long'))) {
    return make('This conversation grew too long for the model - type /model to switch, or /clear to start fresh.', 'context');
  }
  return make(
    "Something went wrong with that request and I don't recognise the reason - please ask again. Type /verbose to see the technical details next time.",
    'other'
  );
}
