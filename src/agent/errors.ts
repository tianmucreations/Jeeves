export type ErrorKind = 'auth' | 'payment' | 'rate-limit' | 'network' | 'model' | 'context' | 'other';

export interface PlainError {
  message: string;
  kind: ErrorKind;
  // The original technical text, shown only when /verbose is on.
  detail: string;
}

// The AI service's name as the user knows it, for messages that name it.
function serviceName(providerId: string | undefined): string {
  if (providerId === 'zai') return 'Z.ai';
  if (providerId === 'ollama') return 'Ollama';
  return 'OpenRouter';
}

// Turns technical failures into plain English (Phase 9 polish). Nothing technical
// reaches the screen: unrecognised failures get a plain sentence, and the raw text
// travels in detail for /verbose.
export function plainError(error: unknown, providerId?: string): PlainError {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.toLowerCase();
  const service = serviceName(providerId);
  const make = (message: string, kind: ErrorKind): PlainError => ({ message, kind, detail: raw });

  if (text.includes('no openrouter api key') || text.includes('no z.ai key')) {
    return make("There's no key yet - type /keys to add one.", 'auth');
  }
  if (text.includes('401') || text.includes('unauthorized') || text.includes('invalid api key') || text.includes('not authenticated')) {
    return make(`${service} didn't accept the key - type /keys to check or replace it.`, 'auth');
  }
  // Z.ai's flat plan reports its time window as "Usage limit reached for 5 hour.
  // Your limit will reset at 2026-09-17 13:03:01" (seen in a real session). The
  // reset time is repeated exactly as Z.ai gave it - its time zone is not stated.
  if (text.includes('usage limit')) {
    const reset = raw.match(/reset at \d{4}-\d{2}-\d{2} (\d{2}:\d{2})/i);
    const when = reset ? ` Z.ai says it resets at ${reset[1]}.` : '';
    return make(`Your ${service} plan has used up its allowance for now.${when} Type /model to use a different model meanwhile.`, 'payment');
  }
  if (text.includes('402') || text.includes('insufficient') || text.includes('out of credit') || text.includes('quota')) {
    return make(`${service} credit ran out - top up at openrouter.ai/credits, then ask again.`, 'payment');
  }
  if (text.includes('429') || text.includes('rate limit') || text.includes('rate_limit') || text.includes('too many requests')) {
    return make(`${service} is asking us to slow down - wait a few seconds and ask again.`, 'rate-limit');
  }
  if (
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('enotfound') ||
    text.includes('econnrefused') ||
    text.includes('econnreset') ||
    text.includes('etimedout') ||
    text.includes('timeout') ||
    text.includes('eai_again') ||
    text.includes('socket hang up')
  ) {
    return make(`Couldn't reach ${service} - check the internet connection and ask again in a moment.`, 'network');
  }
  if (text.includes('model') && (text.includes('not found') || text.includes('404'))) {
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
