import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { withRateLimitRetry } from '../src/agent/retry.js';
import { recordModelFailure, recordModelSuccess, isModelUnreliable } from '../src/agent/model-health.js';
import { session } from '../src/state/session.js';

describe('automatic retry after a rate limit', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('tries again on its own after "asking us to slow down", and succeeds', async () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      if (calls < 2) return Promise.reject(new Error('429 Too Many Requests'));
      return Promise.resolve('ok');
    };
    const promise = withRateLimitRetry(run, 'openrouter', new AbortController().signal);
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
    expect(calls).toBe(2);
  });

  it('gives up after five tries and throws the real error, not a fake success', async () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.reject(new Error('429 Too Many Requests'));
    };
    const promise = withRateLimitRetry(run, 'openrouter', new AbortController().signal);
    const assertion = expect(promise).rejects.toThrow('429');
    await vi.runAllTimersAsync();
    await assertion;
    expect(calls).toBe(5); // the first try plus four retries (OpenCode's policy)
  });

  it('retries a bad server (5xx) and a dropped connection, not just rate limits', async () => {
    for (const message of ['500 Internal Server Error', 'fetch failed']) {
      let calls = 0;
      const run = () => {
        calls += 1;
        if (calls < 2) return Promise.reject(new Error(message));
        return Promise.resolve('ok');
      };
      const promise = withRateLimitRetry(run, 'openrouter', new AbortController().signal);
      await vi.runAllTimersAsync();
      await expect(promise).resolves.toBe('ok');
      expect(calls).toBe(2);
    }
  });

  it('never retries an over-long conversation or a vanished model', async () => {
    for (const message of ['context length too long', '404 model not found']) {
      let calls = 0;
      const run = () => {
        calls += 1;
        return Promise.reject(new Error(message));
      };
      await expect(withRateLimitRetry(run, 'openrouter', new AbortController().signal)).rejects.toThrow();
      expect(calls).toBe(1);
    }
  });

  it('waits what the service asks (Retry-After) and says so in the bar', async () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      if (calls < 2) {
        const error = new Error('429 Too Many Requests') as Error & { headers?: Record<string, string> };
        error.headers = { 'retry-after': '7' };
        return Promise.reject(error);
      }
      return Promise.resolve('ok');
    };
    const promise = withRateLimitRetry(run, 'openrouter', new AbortController().signal);
    await vi.advanceTimersByTimeAsync(100);
    expect(session.busyNote).toContain('retrying in 7s');
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toBe('ok');
  });

  it('never retries a failure that has nothing to do with rate limits', async () => {
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.reject(new Error('401 Unauthorized'));
    };
    await expect(withRateLimitRetry(run, 'openrouter', new AbortController().signal)).rejects.toThrow('401');
    expect(calls).toBe(1);
  });

  it('stops waiting at once when the job is cancelled mid-wait', async () => {
    const controller = new AbortController();
    let calls = 0;
    const run = () => {
      calls += 1;
      return Promise.reject(new Error('429 Too Many Requests'));
    };
    const promise = withRateLimitRetry(run, 'openrouter', controller.signal);
    const assertion = expect(promise).rejects.toThrow('429');
    controller.abort();
    await vi.runAllTimersAsync();
    await assertion;
    expect(calls).toBe(1); // stopped before a second try
  });
});

describe('a model that keeps failing drops out of the Free list', () => {
  it('one failure is not enough to call it unreliable', () => {
    recordModelFailure('a-fresh-model');
    expect(isModelUnreliable('a-fresh-model')).toBe(false);
  });

  it('two failures in a row mark it unreliable', () => {
    recordModelFailure('a-flaky-model');
    recordModelFailure('a-flaky-model');
    expect(isModelUnreliable('a-flaky-model')).toBe(true);
  });

  it('a success afterwards clears it', () => {
    recordModelFailure('a-recovering-model');
    recordModelFailure('a-recovering-model');
    expect(isModelUnreliable('a-recovering-model')).toBe(true);
    recordModelSuccess('a-recovering-model');
    expect(isModelUnreliable('a-recovering-model')).toBe(false);
  });

  it('failures on one model never affect another', () => {
    recordModelFailure('model-a');
    recordModelFailure('model-a');
    expect(isModelUnreliable('model-b')).toBe(false);
  });
});
