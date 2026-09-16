import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { shortModelName, compactNumber } from '../src/components/Footer.js';
import { session } from '../src/state/session.js';
import { getHiddenMetrics, setHiddenMetrics } from '../src/platform/config.js';

describe('compact footer formatting', () => {
  it('shortens model names', () => {
    expect(shortModelName('z-ai/glm-5.3')).toBe('glm-5.3');
    expect(shortModelName('gpt-4o')).toBe('gpt-4o');
  });

  it('compacts token counts', () => {
    expect(compactNumber(0)).toBe('0');
    expect(compactNumber(1234)).toBe('1.2k');
    expect(compactNumber(1234567)).toBe('1.2M');
  });
});

describe('footer visibility', () => {
  beforeEach(() => {
    session.hiddenMetrics = [];
    session.footerExpanded = null;
  });

  afterEach(() => {
    session.hiddenMetrics = [];
    session.footerExpanded = null;
  });

  it('starts in the compact view', () => {
    expect(session.footerExpanded).toBeNull();
  });

  it('Tab expands and cycles the metrics, then wraps back to compact', () => {
    session.tabFooter();
    expect(session.footerExpanded).toBe('session');
    session.tabFooter();
    expect(session.footerExpanded).toBe('context');
    session.tabFooter();
    expect(session.footerExpanded).toBe('cache');
    session.tabFooter();
    expect(session.footerExpanded).toBe('today');
    session.tabFooter();
    expect(session.footerExpanded).toBe('credit');
    session.tabFooter();
    expect(session.footerExpanded).toBe('speed');
    session.tabFooter();
    expect(session.footerExpanded).toBeNull();
  });

  it('hidden metrics are skipped while cycling', () => {
    session.setHiddenMetrics(['session', 'today']);
    session.tabFooter();
    expect(session.footerExpanded).toBe('context');
    session.tabFooter();
    expect(session.footerExpanded).toBe('cache');
    session.tabFooter();
    expect(session.footerExpanded).toBe('credit');
    session.tabFooter();
    expect(session.footerExpanded).toBe('speed');
    session.tabFooter();
    expect(session.footerExpanded).toBeNull();
  });

  it('Esc returns to the compact view', () => {
    session.tabFooter();
    session.escapeFooter();
    expect(session.footerExpanded).toBeNull();
  });
});

describe('hidden metrics config', () => {
  it('round-trips and rejects unknown metric names', () => {
    setHiddenMetrics(['session', 'bogus']);
    expect(getHiddenMetrics()).toEqual(['session']);
    setHiddenMetrics([]);
    expect(getHiddenMetrics()).toEqual([]);
  });

  it('accepts the cache metric', () => {
    setHiddenMetrics(['cache']);
    expect(getHiddenMetrics()).toEqual(['cache']);
    setHiddenMetrics([]);
  });
});