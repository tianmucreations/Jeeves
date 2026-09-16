import { describe, it, expect } from 'vitest';
import { getStickySessionId, resetStickySession } from '../src/providers/openrouter.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

describe('OpenRouter sticky routing session id', () => {
  it('is a UUID so OpenRouter can use it directly as the routing key', () => {
    expect(getStickySessionId()).toMatch(UUID_RE);
  });

  it('stays the same for the whole conversation so the context keeps hitting the same endpoint cache', () => {
    const first = getStickySessionId();
    expect(getStickySessionId()).toBe(first);
    expect(getStickySessionId()).toBe(first);
  });

  it('rotates when the conversation starts fresh', () => {
    const before = getStickySessionId();
    resetStickySession();
    const after = getStickySessionId();
    expect(after).toMatch(UUID_RE);
    expect(after).not.toBe(before);
  });
});

describe('cached-token accounting', () => {
  it('accumulates cache reads and reports the hit rate', async () => {
    const { session } = await import('../src/state/session.js');
    session.tokensIn = 0;
    session.tokensOut = 0;
    session.tokensCached = 0;
    expect(session.cacheHitRate()).toBeNull();
    session.addUsage(1000, 100, 0, 600);
    session.addUsage(1000, 100, 0, 900);
    expect(session.tokensCached).toBe(1500);
    expect(session.cacheHitRate()).toBe(0.75);
    session.tokensIn = 0;
    session.tokensOut = 0;
    session.tokensCached = 0;
  });
});
