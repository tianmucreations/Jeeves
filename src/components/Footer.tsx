import React from 'react';
import { Box, Text } from 'ink';
import { useSession, DEFAULT_CONTEXT_TOKENS } from '../state/session.js';
import { UsageBar } from './UsageBar.js';

// The five Tab-cycled metrics in plain-English labels; anything the provider does
// not report falls back to the context percentage (spec 2.4).
interface MetricBar {
  label: string;
  value: number;
  max: number;
  unit?: string;
  suffix: string;
}

function contextMetric(contextTokens: number, tokensPerMinute: number): MetricBar {
  return {
    label: 'context',
    value: contextTokens,
    max: DEFAULT_CONTEXT_TOKENS,
    suffix: forecastContext(contextTokens, tokensPerMinute),
  };
}

function forecastContext(contextTokens: number, tokensPerMinute: number): string {
  if (tokensPerMinute <= 0 || contextTokens <= 0) return '';
  const minutes = (DEFAULT_CONTEXT_TOKENS - contextTokens) / tokensPerMinute;
  if (minutes <= 0 || minutes > 600) return '';
  return `~${Math.max(1, Math.round(minutes))}m left`;
}

function forecastRateReset(resetEpochSeconds: number): string {
  if (!resetEpochSeconds) return '';
  const seconds = resetEpochSeconds - Date.now() / 1000;
  if (seconds <= 0 || seconds > 3600) return '';
  return `resets in ${Math.max(1, Math.round(seconds / 60))}m`;
}

export function Footer() {
  const s = useSession();
  const contextTokens = s.estimateContextTokens();
  const tpm = s.tokensPerMinute();

  let bar = contextMetric(contextTokens, tpm);
  let metricShowsDollars = false;
  if (s.footerMetric === 0) {
    bar = { label: 'session', value: s.tokensIn + s.tokensOut, max: DEFAULT_CONTEXT_TOKENS, suffix: '' };
  } else if (s.footerMetric === 2) {
    if (s.spend > 0 && s.creditLimit) {
      bar = { label: 'today', value: s.spend, max: s.creditLimit, suffix: '' };
    }
  } else if (s.footerMetric === 3) {
    if (s.creditRemaining !== null && s.creditLimit) {
      bar = {
        label: 'credit',
        value: s.creditLimit - s.creditRemaining,
        max: s.creditLimit,
        unit: 'used',
        suffix: `· $${s.creditRemaining.toFixed(2)} left`,
      };
      metricShowsDollars = true;
    }
  } else if (s.footerMetric === 4) {
    if (s.rateLimit && s.rateLimit.limit > 0) {
      bar = {
        label: 'speed',
        value: s.rateLimit.limit - s.rateLimit.remaining,
        max: s.rateLimit.limit,
        suffix: forecastRateReset(s.rateLimit.reset),
      };
    }
  }

  // The dollar figure lives in the metric itself when cycling credit, otherwise on the right.
  const showTrailingCredit = !metricShowsDollars;
  const creditText = s.creditRemaining !== null ? `$${s.creditRemaining.toFixed(2)}` : '$—';

  return (
    <Box justifyContent="space-between">
      <Text dimColor>{s.model}</Text>
      <Text dimColor>
        <UsageBar label={bar.label} value={bar.value} max={bar.max} unit={bar.unit} width={8} />
        {bar.suffix ? <Text dimColor> {bar.suffix}</Text> : null}
        {showTrailingCredit ? <Text dimColor> · {creditText} credit</Text> : null}
        <Text dimColor> · {tpm} tok/min</Text>
      </Text>
    </Box>
  );
}