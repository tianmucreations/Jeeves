import React, { useEffect, useState } from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import { execa } from 'execa';
import { platform } from 'node:os';
import { useSession, type Status } from '../state/session.js';

const DOT = '⬤';

// Two true-colour greens alternate roughly twice per second while working.
const PULSE_GREENS = ['#00FF00', '#007800'];
const PULSE_INTERVAL_MS = 500;

const STATIC_COLORS: Record<Exclude<Status, 'working'>, string> = {
  idle: '#FF0000',
  'awaiting-approval': '#FFB000',
  disconnected: '#808080',
};

const TITLE_LABELS: Record<Status, string> = {
  working: 'working',
  idle: 'done',
  'awaiting-approval': 'approval',
  disconnected: 'offline',
};

const TERMINAL_APP_NAMES: Record<string, string> = {
  appleterminal: 'Terminal',
  itermapp: 'iTerm2',
  iterm: 'iTerm2',
  vscode: 'Code',
  warpterminal: 'Warp',
  ghostty: 'Ghostty',
  tmux: 'Terminal',
};

function expectedTerminalApp(): string {
  const raw = (process.env.TERM_PROGRAM ?? '').toLowerCase().replace(/[^a-z]/g, '');
  return TERMINAL_APP_NAMES[raw] ?? 'Terminal';
}

// Mirror the state in the terminal tab title (OSC 0). Terminals without OSC support
// ignore the sequence; non-TTY streams and dumb terminals are skipped so no escape
// bytes ever reach output they would corrupt.
function setTabTitle(label: string): void {
  if (!process.stdout.isTTY || process.env.TERM === 'dumb') return;
  try {
    process.stdout.write(`\x1b]0;${label}\x07`);
  } catch {
    // A closed stream must never crash the app.
  }
}

// Best-effort focus check via AppleScript, intentionally macOS-only (spec Phase 8
// allows per-platform checks); other platforms simply always deliver the notification.
async function isTerminalFocused(): Promise<boolean> {
  if (platform() !== 'darwin') return false;
  try {
    const front = await execa('osascript', [
      '-e',
      'tell application "System Events" to get name of first process whose frontmost is true',
    ]);
    const expected = expectedTerminalApp().toLowerCase();
    return front.stdout.toLowerCase().includes(expected);
  } catch {
    return false;
  }
}

// macOS has a notifier built in (AppleScript's display notification) - the same
// channel the old notification package used, without the package. Elsewhere the
// terminal's own alert (the bell) is the one channel every terminal supports.
async function notify(title: string, message: string): Promise<void> {
  if (platform() === 'darwin') {
    await execa('osascript', ['-e', `display notification "${message.replace(/"/g, '')}" with title "${title.replace(/"/g, '')}"`]);
    return;
  }
  if (process.stdout.isTTY && process.env.TERM !== 'dumb') {
    try {
      process.stdout.write('\x07');
    } catch {
      // A closed stream must never crash the app.
    }
  }
}

// Claude Code's useNotifyAfterTimeout: a permission question is a stopped job.
// If it still waits after six seconds and the person is elsewhere, say so.
async function notifyApprovalWaiting(): Promise<void> {
  try {
    if (await isTerminalFocused()) return;
    await notify('Jeeves', 'Jeeves needs your permission to continue.');
  } catch {
    // Notifications are best-effort and must never surface errors.
  }
}

export function TrafficLight() {
  const s = useSession();
  const [pulseTick, setPulseTick] = useState(0);

  // Pulse only while working; the interval is always cleaned up on change and unmount.
  useEffect(() => {
    if (s.status !== 'working') {
      setPulseTick(0);
      return;
    }
    const timer = setInterval(() => setPulseTick((tick) => (tick + 1) % 2), PULSE_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [s.status]);

  // Mirror the state in the terminal tab title; degrades silently where unsupported.
  useEffect(() => {
    setTabTitle(TITLE_LABELS[s.status]);
  }, [s.status]);

  // A permission question left waiting: one notification after six seconds, per
  // question (a new question restarts the timer with its own serial number).
  useEffect(() => {
    if (!s.approvalPending) return;
    const timer = setTimeout(() => void notifyApprovalWaiting(), 6_000);
    return () => clearTimeout(timer);
  }, [s.approvalPending, s.approvalSerial]);

  const color = s.status === 'working' ? PULSE_GREENS[pulseTick] : STATIC_COLORS[s.status];
  return <Text>{chalk.hex(color)(DOT)}</Text>;
}