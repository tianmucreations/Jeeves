import React from 'react';
import { Box, Text, useStdout } from 'ink';
import { useSession } from '../state/session.js';
import { allowanceToday } from '../agent/spending.js';
import { isAuto, AUTO_WORKER_MODEL } from '../agent/auto.js';

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
  // Today's allowance (daily limit plus any extra agreed today).
  allowance: number;
  tidying: boolean;
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
  if (info.tidying && info.providerId !== 'openrouter') return [{ text: 'tidying up…' }];
  if (info.providerId === 'zai') {
    if (info.planResetAt === null) return [{ text: 'flat-rate plan' }];
    const when = info.planResetAt ? ` · resets @ ${info.planResetAt}` : '';
    return [{ text: `plan used up${when}`, color: 'red' }];
  }
  if (info.providerId === 'ollama') {
    return [{ text: 'on this computer · free' }];
  }
  const spent = info.todaySpend ?? 0;
  // Compared in whole cents, so $2.40 of $3.00 is exactly 80%.
  const cents = Math.round(spent * 100);
  const limitCents = Math.round(info.allowance * 100);
  const segments: FooterSegment[] = [
    {
      text: `today ${info.todaySpend === null ? '$—' : money(spent)} of ${money(info.allowance)}`,
      color: cents >= limitCents ? 'red' : cents * 10 >= limitCents * 8 ? 'yellow' : undefined,
    },
  ];
  if (info.tidying) segments.unshift({ text: 'tidying up…' });
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
    allowance: allowanceToday(),
    tidying: s.tidying,
    todaySpend: s.todaySpend,
    creditRemaining: s.creditRemaining,
    creditIsAccount: s.creditIsAccount,
    planResetAt: s.planResetAt,
  });
  const rightWidth = segments.reduce((sum, segment) => sum + segment.text.length, 0) + 3 * (segments.length - 1);
  // In Auto mode the bar names the model actually working: "auto · deepseek-v4-flash-0731".
  const name = isAuto(s.model) ? `auto · ${shortModelName(s.activeModel ?? AUTO_WORKER_MODEL)}` : shortModelName(s.model);
  const model = fitModelName(name, columns - rightWidth - 2);

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
