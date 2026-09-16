import { describe, it, expect } from 'vitest';
import { usageFraction, usageColor, benefitColor, renderBar } from '../src/components/UsageBar.js';

describe('usage bar thresholds', () => {
  it('clamps fractions into 0..1', () => {
    expect(usageFraction(-5, 100)).toBe(0);
    expect(usageFraction(150, 100)).toBe(1);
    expect(usageFraction(50, 0)).toBe(0);
    expect(usageFraction(50, 100)).toBe(0.5);
  });

  it('is green below 70%', () => {
    expect(usageColor(0)).toBe('#00CC00');
    expect(usageColor(0.69)).toBe('#00CC00');
  });

  it('is amber from 70% to 89%', () => {
    expect(usageColor(0.7)).toBe('#FFB000');
    expect(usageColor(0.89)).toBe('#FFB000');
  });

  it('is red at 90% and above', () => {
    expect(usageColor(0.9)).toBe('#FF0000');
    expect(usageColor(1)).toBe('#FF0000');
  });

  it('renders a filled bar of the right length', () => {
    expect(renderBar(0.5, 10)).toBe('█████░░░░░');
    expect(renderBar(1, 4)).toBe('████');
    expect(renderBar(0, 4)).toBe('░░░░');
  });
});

describe('benefit bar thresholds (cache hit rate)', () => {
  it('is green at 70% and above - caching is doing its job', () => {
    expect(benefitColor(0.7)).toBe('#00CC00');
    expect(benefitColor(1)).toBe('#00CC00');
  });

  it('is amber from 20% to 69%', () => {
    expect(benefitColor(0.2)).toBe('#FFB000');
    expect(benefitColor(0.69)).toBe('#FFB000');
  });

  it('is red below 20% - worth a look', () => {
    expect(benefitColor(0)).toBe('#FF0000');
    expect(benefitColor(0.19)).toBe('#FF0000');
  });
});