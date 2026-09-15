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
}: {
  label: string;
  value: number;
  max: number;
  unit?: string;
  width?: number;
}) {
  const fraction = usageFraction(value, max);
  const color = usageColor(fraction);
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