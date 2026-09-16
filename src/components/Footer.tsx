import React from 'react';
import { Text } from 'ink';
import { useSession, DEFAULT_CONTEXT_TOKENS } from '../state/session.js';
import { usageFraction, usageColor, benefitColor, renderBar } from './UsageBar.js';

export function shortModelName(model: string): string {
  const short = model.split('/').pop();
  return short && short.length > 0 ? short : model;
}

// Long model names (for example deepseek-v4-flash-0731) would leave no room for
// the metrics in the bottom border; the name clips first.
export function compactModelName(model: string): string {
  const short = shortModelName(model);
  return short.length > 14 ? short.slice(0, 13) + '…' : short;
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
  goodWhenFull?: boolean;
}

interface Span {
  text: string;
  color?: string;
}

// The window's bottom border, drawn by hand so the info bar sits inside the
// border line itself: rounded corner, "─ model ─" on the left, dashes across,
// the metrics on the right, corner at the end. Everything is dim except the
// metric values, which keep their threshold colours.
export function Footer({ columns }: { columns: number }) {
  const s = useSession();
  const contextTokens = s.estimateContextTokens();
  const tpm = s.tokensPerMinute();
  const cacheRate = s.cacheHitRate();
  const model = compactModelName(s.model);

  let spans: Span[] = [];
  if (s.footerExpanded !== null) {
    let bar: MetricBar = {
      label: 'context',
      value: contextTokens,
      max: DEFAULT_CONTEXT_TOKENS,
      suffix: forecastContext(contextTokens, tpm),
    };
    if (s.footerExpanded === 'session') {
      bar = { label: 'session', value: s.tokensIn + s.tokensOut, max: DEFAULT_CONTEXT_TOKENS, suffix: '' };
    } else if (s.footerExpanded === 'cache' && cacheRate !== null) {
      bar = {
        label: 'cache',
        value: s.tokensCached,
        max: s.tokensIn,
        unit: 'of input read from cache',
        suffix: '',
        goodWhenFull: true,
      };
    } else if (s.footerExpanded === 'today' && s.spend > 0 && s.creditLimit) {
      bar = { label: 'today', value: s.spend, max: s.creditLimit, suffix: '' };
    } else if (s.footerExpanded === 'credit' && s.creditRemaining !== null && s.creditLimit) {
      bar = {
        label: 'credit',
        value: s.creditLimit - s.creditRemaining,
        max: s.creditLimit,
        unit: 'used',
        suffix: `· $${s.creditRemaining.toFixed(2)} ${s.creditIsAccount ? 'left' : 'key cap'}`,
      };
    } else if (s.footerExpanded === 'speed' && s.rateLimit && s.rateLimit.limit > 0) {
      bar = {
        label: 'speed',
        value: s.rateLimit.limit - s.rateLimit.remaining,
        max: s.rateLimit.limit,
        suffix: forecastRateReset(s.rateLimit.reset),
      };
    }
    const fraction = usageFraction(bar.value, bar.max);
    spans = [
      { text: `${bar.label} ` },
      { text: `${renderBar(fraction, 20)} ${pct(fraction)}`, color: bar.goodWhenFull ? benefitColor(fraction) : usageColor(fraction) },
      ...(bar.unit ? [{ text: ` ${bar.unit}` }] : []),
      ...(bar.suffix ? [{ text: ` ${bar.suffix}` }] : []),
    ];
  } else {
    // The compact view shows every metric at all times - nothing needs a key press.
    const sessionFraction = usageFraction(s.tokensIn + s.tokensOut, DEFAULT_CONTEXT_TOKENS);
    const contextFraction = usageFraction(contextTokens, DEFAULT_CONTEXT_TOKENS);
    const segments: { key: string; span: Span }[] = [
      { key: 'session', span: { text: `sess ${pct(sessionFraction)}`, color: usageColor(sessionFraction) } },
      { key: 'context', span: { text: `ctx ${pct(contextFraction)}`, color: usageColor(contextFraction) } },
      {
        key: 'cache',
        span:
          cacheRate === null
            ? { text: 'cache —' }
            : { text: `cache ${pct(cacheRate)}`, color: benefitColor(cacheRate) },
      },
      { key: 'today', span: { text: `today $${s.spend.toFixed(2)}` } },
      {
        key: 'credit',
        span: {
          text:
            s.creditRemaining !== null
              ? s.creditIsAccount
                ? `$${s.creditRemaining.toFixed(2)} left`
                : `$${s.creditRemaining.toFixed(2)} key cap`
              : '$— left',
        },
      },
    ];
    spans = segments
      .filter((segment) => !s.hiddenMetrics.includes(segment.key))
      .map((segment) => segment.span);
    spans.push({ text: `${compactNumber(tpm)} tpm`, color: undefined });
    for (let i = spans.length - 2; i >= 0; i--) spans.splice(i + 1, 0, { text: ' · ' });
  }

  // The border must fit exactly: clip the metrics (with an ellipsis) when the
  // terminal is too narrow, and drop them entirely rather than break the line.
  // Fixed parts: "╰─ " + model + " " + " " + "─╯".
  const fixed = 3 + model.length + 1 + 1 + 2;
  const full = spans.map((span) => span.text).join('');
  const budget = columns - fixed;
  const clipped = full.length > budget;
  const text = clipped ? full.slice(0, Math.max(0, budget - 1)) : full;
  if (text.length === 0 && clipped) {
    return (
      <Text>
        <Text dimColor>╰─ {model} </Text>
        <Text dimColor>{'─'.repeat(Math.max(0, columns - model.length - 5))}╯</Text>
      </Text>
    );
  }
  const dashes = Math.max(0, columns - fixed - text.length - (clipped ? 1 : 0));

  let consumed = 0;
  const rendered: React.ReactNode[] = [];
  for (const span of spans) {
    const within = text.slice(consumed, consumed + span.text.length);
    consumed += span.text.length;
    if (within.length === 0) break;
    rendered.push(
      span.color ? (
        <Text key={rendered.length} color={span.color}>
          {within}
        </Text>
      ) : (
        <Text key={rendered.length} dimColor>
          {within}
        </Text>
      )
    );
  }

  return (
    <Text>
      <Text dimColor>╰─ {model} </Text>
      <Text dimColor>{'─'.repeat(dashes)}</Text>
      {text.length > 0 ? (
        <Text dimColor>
          {rendered}
          {clipped ? '…' : ''}{' '}
        </Text>
      ) : null}
      <Text dimColor>─╯</Text>
    </Text>
  );
}
