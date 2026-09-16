import React from 'react';
import { Text } from 'ink';

export function usageFraction(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0;
  return Math.min(1, Math.max(0, value / max));
}

// Green below 70%, amber 70-89%, red 90% and above.
export function usageColor(fraction: number): string {
  if (fraction >= 0.9) return '#FF0000';
  if (fraction >= 0.7) return '#FFB000';
  return '#00CC00';
}

// Colours for "higher is better" bars such as the cache hit rate: a full bar is
// the good outcome, so green at 70%+, amber 20-69%, red below 20%.
export function benefitColor(fraction: number): string {
  if (fraction >= 0.7) return '#00CC00';
  if (fraction >= 0.2) return '#FFB000';
  return '#FF0000';
}

export function renderBar(fraction: number, width: number): string {
  const filled = Math.round(fraction * width);
  return '█'.repeat(filled) + '░'.repeat(Math.max(0, width - filled));
}

// A filled bar followed by a percentage, coloured by how full the limit is.
export function UsageBar({
  label,
  value,
  max,
  unit,
  width = 10,
  goodWhenFull = false,
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  width?: number;
  goodWhenFull?: boolean;
}) {
  const fraction = usageFraction(value, max);
  const color = goodWhenFull ? benefitColor(fraction) : usageColor(fraction);
  const percent = Math.round(fraction * 100);
  return (
    <Text>
      <Text dimColor>{label} </Text>
      <Text color={color}>
        {renderBar(fraction, width)} {percent}%
      </Text>
      {unit ? <Text dimColor> {unit}</Text> : null}
    </Text>
  );
}