import React from 'react';
import { Box, Text, useWindowSize } from 'ink';
import { session, useSession } from '../state/session.js';
import { allowanceToday } from '../agent/spending.js';
import { isAuto, workerModel } from '../agent/auto.js';
import { isDirectService, CUSTOM_SERVICE_ID } from '../providers/direct-services.js';
import { hasCredentials } from '../providers/index.js';

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
  // A short note while something quick runs ('backing up…', 'undoing…').
  busyNote?: string | null;
  todaySpend: number | null;
  creditRemaining: number | null;
  creditIsAccount: boolean;
  planResetAt: string | null;
  // False before any AI service is connected: the bar says so instead of "$—".
  connected?: boolean;
  // What to do about it, in this app's words ("type /keys" or "open Settings").
  connectHint?: string;
}

const money = (value: number) => `$${value.toFixed(2)}`;

// The info bar says only what is worth a glance: which model is working (left),
// and on the right what today has cost and what is left - or, for a flat-rate
// plan, whether it has allowance. Warnings appear only when they matter.
export function footerSegments(info: FooterInfo): FooterSegment[] {
  if (info.connected === false) return [{ text: `not connected - ${info.connectHint ?? 'type /keys to connect'}`, color: 'yellow' }];
  const busy = info.busyNote ?? (info.tidying ? 'tidying up…' : null);
  const direct = isDirectService(info.providerId);
  if (busy && info.providerId !== 'openrouter' && !direct) return [{ text: busy }];
  if (info.providerId === 'zai') {
    if (info.planResetAt === null) return [{ text: 'flat-rate plan' }];
    const when = info.planResetAt ? ` · resets @ ${info.planResetAt}` : '';
    return [{ text: `plan used up${when}`, color: 'red' }];
  }
  if (info.providerId === 'ollama') {
    return [{ text: 'on this computer · free' }];
  }
  // A compatible service lists no prices, so its spending can't be worked out.
  if (info.providerId === CUSTOM_SERVICE_ID) {
    return [{ text: 'cost not tracked' }];
  }
  const spent = info.todaySpend ?? 0;
  // Compared in whole cents, so $2.40 of $3.00 is exactly 80%.
  const cents = Math.round(spent * 100);
  const limitCents = Math.round(info.allowance * 100);
  const segments: FooterSegment[] = [
    {
      // "~": worked out from the company's price list, not reported by it.
      text: `today ${direct ? '~' : ''}${info.todaySpend === null ? '$—' : money(spent)} of ${money(info.allowance)}`,
      color: cents >= limitCents ? 'red' : cents * 10 >= limitCents * 8 ? 'yellow' : undefined,
    },
  ];
  if (busy) segments.unshift({ text: busy });
  // The companies don't tell a key what credit is left.
  if (direct) return segments;
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

// A real button at the start of the info bar, under the typing box (owner, 23
// Sept: "an actual button, like the Approve button"). Drawn the way the approval
// buttons are, so it reads as something to click.
export const SETTINGS_BUTTON = ' Settings ';

// Whether a click at this column lands on the button (columns count from 1).
export function onSettingsButton(col: number): boolean {
  return col >= 1 && col <= SETTINGS_BUTTON.length;
}

export function Footer() {
  const s = useSession();
  // useWindowSize so the footer re-wraps live when the window is resized,
  // instead of keeping the column count it started with.
  const { columns: windowColumns, rows: windowRows } = useWindowSize();
  const columns = Math.max(windowColumns ?? 80, 40);
  // The info bar is the window's last row.
  session.footerClick = (col: number, row: number) => {
    if (row !== (windowRows ?? 24) || !onSettingsButton(col)) return false;
    // A question waiting on the buttons above is answered first, never hidden.
    if (session.approvalPending) return true;
    session.openSettings();
    return true;
  };
  const segments = footerSegments({
    providerId: s.providerId,
    allowance: allowanceToday(),
    tidying: s.tidying,
    busyNote: s.busyNote ?? (s.thinkingSince !== null ? 'thinking…' : null),
    todaySpend: s.todaySpend,
    creditRemaining: s.creditRemaining,
    creditIsAccount: s.creditIsAccount,
    planResetAt: s.planResetAt,
    // Whether a service is set up at all - not the brief "disconnected" of an internet drop.
    connected: hasCredentials(),
  });
  const rightWidth = segments.reduce((sum, segment) => sum + segment.text.length, 0) + 3 * (segments.length - 1);
  // In Auto mode the bar names the model actually working: "auto · deepseek-v4-flash-0731".
  const name = isAuto(s.model) ? `auto · ${shortModelName(s.activeModel ?? workerModel())}` : shortModelName(s.model);
  const model = fitModelName(name, columns - rightWidth - 2 - SETTINGS_BUTTON.length - 2);

  return (
    <Box justifyContent="space-between">
      <Text>
        {/* Half blocks as the button's ends: the yellow starts at the middle of the
            first column, exactly where the box's left border line is drawn (a full
            cell poked out half a column to its left - owner, 23 Sept). */}
        <Text color="yellow">▐</Text>
        <Text color="yellow" inverse>
          {SETTINGS_BUTTON.slice(1, -1)}
        </Text>
        <Text color="yellow">▌</Text>
        {'  ' + model}
      </Text>
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
