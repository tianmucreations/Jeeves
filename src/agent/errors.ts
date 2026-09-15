export type ErrorKind = 'auth' | 'payment' | 'rate-limit' | 'network' | 'model' | 'context' | 'other';

export interface PlainError {
  message: string;
  kind: ErrorKind;
}

function firstLine(text: string): string {
  const line = text.split('\n')[0].trim();
  return line.length > 0 ? line : 'Something went wrong - please ask again.';
}

// Turns technical failures into plain English (Phase 9 polish).
export function plainError(error: unknown): PlainError {
  const raw = error instanceof Error ? error.message : String(error);
  const text = raw.toLowerCase();

  if (text.includes('no openrouter api key')) {
    return { message: "There's no key yet - type /keys to add one.", kind: 'auth' };
  }
  if (text.includes('401') || text.includes('unauthorized') || text.includes('invalid api key') || text.includes('not authenticated')) {
    return { message: "That key wasn't accepted - type /keys to check or replace it.", kind: 'auth' };
  }
  if (text.includes('402') || text.includes('insufficient') || text.includes('out of credit') || text.includes('quota')) {
    return { message: 'OpenRouter credit ran out - top up at openrouter.ai/credits, then ask again.', kind: 'payment' };
  }
  if (text.includes('429') || text.includes('rate limit') || text.includes('rate_limit') || text.includes('too many requests')) {
    return { message: 'OpenRouter is asking us to slow down - wait a few seconds and ask again.', kind: 'rate-limit' };
  }
  if (
    text.includes('fetch failed') ||
    text.includes('network') ||
    text.includes('enotfound') ||
    text.includes('econnrefused') ||
    text.includes('etimedout') ||
    text.includes('timeout') ||
    text.includes('eai_again') ||
    text.includes('socket hang up')
  ) {
    return { message: 'Lost connection - please ask again in a moment.', kind: 'network' };
  }
  if (text.includes('model') && (text.includes('not found') || text.includes('404'))) {
    return { message: "That model isn't available any more - type /model to pick another.", kind: 'model' };
  }
  if (text.includes('context') && (text.includes('length') || text.includes('too long'))) {
    return {
      message: 'This conversation grew too long for the model - type /model to switch, or /clear to start fresh.',
      kind: 'context',
    };
  }
  return { message: firstLine(raw), kind: 'other' };
}