import React from 'react';
import { Box, Text } from 'ink';
import { useSession, DEFAULT_CONTEXT_TOKENS } from '../state/session.js';
import { UsageBar } from './UsageBar.js';

// The five Tab-cycled metrics; anything the provider does not report falls back
// to the context-window percentage (spec 2.4).
interface MetricBar {
  label: string;
  value: number;
  max: number;
  unit?: string;
  forecast: string;
}

function contextMetric(contextTokens: number, tokensPerMinute: number): MetricBar {
  return {
    label: 'ctx',
    value: contextTokens,
    max: DEFAULT_CONTEXT_TOKENS,
    forecast: forecastContext(contextTokens, tokensPerMinute),
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
  if (s.footerMetric === 0) {
    bar = { label: 'tok', value: s.tokensIn + s.tokensOut, max: DEFAULT_CONTEXT_TOKENS, forecast: '' };
  } else if (s.footerMetric === 2) {
    if (s.spend > 0 && s.creditLimit) {
      bar = { label: 'spend', value: s.spend, max: s.creditLimit, forecast: '' };
    }
  } else if (s.footerMetric === 3) {
    if (s.creditRemaining !== null && s.creditLimit) {
      bar = { label: 'credit', value: s.creditLimit - s.creditRemaining, max: s.creditLimit, forecast: '' };
    }
  } else if (s.footerMetric === 4) {
    if (s.rateLimit && s.rateLimit.limit > 0) {
      bar = {
        label: 'rate',
        value: s.rateLimit.limit - s.rateLimit.remaining,
        max: s.rateLimit.limit,
        forecast: forecastRateReset(s.rateLimit.reset),
      };
    }
  }

  const creditText = s.creditRemaining !== null ? `$${s.creditRemaining.toFixed(2)}` : '$—';

  return (
    <Box justifyContent="space-between">
      <Text dimColor>{s.model}</Text>
      <Text dimColor>
        <UsageBar label={bar.label} value={bar.value} max={bar.max} unit={bar.unit} width={8} />
        {bar.forecast ? <Text dimColor> {bar.forecast}</Text> : null}
        <Text dimColor> · {creditText} credit · {tpm} tok/min</Text>
      </Text>
    </Box>
  );
}