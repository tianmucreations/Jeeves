import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useSession } from '../state/session.js';

export function shortModelName(model: string): string {
  const short = model.split('/').pop();
  return short && short.length > 0 ? short : model;
}

export interface FooterSegment {
  text: string;
  color?: 'yellow' | 'red';
}

export interface FooterInfo {
  providerId: string;
  todaySpend: number | null;
  creditRemaining: number | null;
  creditIsAccount: boolean;
  planResetAt: string | null;
}

const money = (value: number) => `$${value.toFixed(2)}`;

// The info bar says only what is worth a glance: which model is working (left),
// and on the right what today has cost and what is left - or, for a flat-rate
// plan, whether it has allowance. Warnings appear only when they matter.
export function footerSegments(info: FooterInfo): FooterSegment[] {
  if (info.providerId === 'zai') {
    if (info.planResetAt === null) return [{ text: 'flat-rate plan' }];
    const when = info.planResetAt ? ` · resets @ ${info.planResetAt}` : '';
    return [{ text: `plan used up${when}`, color: 'red' }];
  }
  if (info.providerId === 'ollama') {
    return [{ text: 'on this computer · free' }];
  }
  const segments: FooterSegment[] = [
    { text: `today ${info.todaySpend === null ? '$—' : money(info.todaySpend)}` },
  ];
  if (info.creditRemaining === null) {
    segments.push({ text: '$— left' });
    return segments;
  }
  const remaining = info.creditRemaining;
  const color = remaining < 1 ? 'red' : remaining < 5 ? 'yellow' : undefined;
  segments.push({ text: `${money(remaining)} ${info.creditIsAccount ? 'left' : 'key limit'}`, color });
  if (remaining < 1) segments.push({ text: 'credit low - top up', color: 'red' });
  return segments;
}

// The model name gives way first so the right side never wraps the bar.
export function fitModelName(name: string, available: number): string {
  if (available <= 1) return '';
  return name.length <= available ? name : name.slice(0, available - 1) + '…';
}

export function Footer() {
  const s = useSession();
  const { stdout } = useStdout();
  const columns = Math.max(stdout.columns ?? 80, 40);
  const segments = footerSegments({
    providerId: s.providerId,
    todaySpend: s.todaySpend,
    creditRemaining: s.creditRemaining,
    creditIsAccount: s.creditIsAccount,
    planResetAt: s.planResetAt,
  });
  const rightWidth = segments.reduce((sum, segment) => sum + segment.text.length, 0) + 3 * (segments.length - 1);
  const model = fitModelName(shortModelName(s.model), columns - rightWidth - 2);

  return (
    <Box justifyContent="space-between">
      <Text>{model}</Text>
      <Text>
        {segments.map((segment, index) => (
          <React.Fragment key={segment.text}>
            {index > 0 ? <Text dimColor> · </Text> : null}
            <Text color={segment.color} dimColor={!segment.color}>
              {segment.text}
            </Text>
          </React.Fragment>
        ))}
      </Text>
    </Box>
  );
}
