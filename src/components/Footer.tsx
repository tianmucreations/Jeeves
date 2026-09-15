import React from 'react';
import { Box, Text } from 'ink';
import { useSession, DEFAULT_CONTEXT_TOKENS } from '../state/session.js';
import { UsageBar, usageFraction, usageColor } from './UsageBar.js';

export function shortModelName(model: string): string {
  const short = model.split('/').pop();
  return short && short.length > 0 ? short : model;
}

export function compactNumber(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return `${Math.round(value)}`;
}

function pct(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
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

interface MetricBar {
  label: string;
  value: number;
  max: number;
  unit?: string;
  suffix: string;
}

export function Footer() {
  const s = useSession();
  const contextTokens = s.estimateContextTokens();
  const tpm = s.tokensPerMinute();

  if (s.footerExpanded !== null) {
    let bar: MetricBar = {
      label: 'context',
      value: contextTokens,
      max: DEFAULT_CONTEXT_TOKENS,
      suffix: forecastContext(contextTokens, tpm),
    };
    if (s.footerExpanded === 'session') {
      bar = { label: 'session', value: s.tokensIn + s.tokensOut, max: DEFAULT_CONTEXT_TOKENS, suffix: '' };
    } else if (s.footerExpanded === 'today' && s.spend > 0 && s.creditLimit) {
      bar = { label: 'today', value: s.spend, max: s.creditLimit, suffix: '' };
    } else if (s.footerExpanded === 'credit' && s.creditRemaining !== null && s.creditLimit) {
      bar = {
        label: 'credit',
        value: s.creditLimit - s.creditRemaining,
        max: s.creditLimit,
        unit: 'used',
        suffix: `· $${s.creditRemaining.toFixed(2)} left`,
      };
    } else if (s.footerExpanded === 'speed' && s.rateLimit && s.rateLimit.limit > 0) {
      bar = {
        label: 'speed',
        value: s.rateLimit.limit - s.rateLimit.remaining,
        max: s.rateLimit.limit,
        suffix: forecastRateReset(s.rateLimit.reset),
      };
    }
    return (
      <Box justifyContent="space-between">
        <Text dimColor>{shortModelName(s.model)}</Text>
        <Text dimColor>
          <UsageBar label={bar.label} value={bar.value} max={bar.max} unit={bar.unit} width={20} />
          {bar.suffix ? <Text dimColor> {bar.suffix}</Text> : null}
        </Text>
      </Box>
    );
  }

  // The compact view shows every metric at all times - nothing needs a key press.
  const sessionFraction = usageFraction(s.tokensIn + s.tokensOut, DEFAULT_CONTEXT_TOKENS);
  const contextFraction = usageFraction(contextTokens, DEFAULT_CONTEXT_TOKENS);
  const segments: { key: string; render: React.ReactNode }[] = [
    {
      key: 'session',
      render: <Text color={usageColor(sessionFraction)}>sess {pct(sessionFraction)}</Text>,
    },
    {
      key: 'context',
      render: <Text color={usageColor(contextFraction)}>ctx {pct(contextFraction)}</Text>,
    },
    {
      key: 'today',
      render: <Text>today ${s.spend.toFixed(2)}</Text>,
    },
    {
      key: 'credit',
      render: <Text>{s.creditRemaining !== null ? `$${s.creditRemaining.toFixed(2)} left` : '$— left'}</Text>,
    },
  ];
  const visible = segments.filter((segment) => !s.hiddenMetrics.includes(segment.key));

  return (
    <Box justifyContent="space-between">
      <Text dimColor>{shortModelName(s.model)}</Text>
      <Text dimColor>
        {visible.map((segment, index) => (
          <React.Fragment key={segment.key}>
            {index > 0 ? ' · ' : null}
            {segment.render}
          </React.Fragment>
        ))}
        {visible.length > 0 ? ' · ' : null}
        <Text>{compactNumber(tpm)} tpm</Text>
      </Text>
    </Box>
  );
}