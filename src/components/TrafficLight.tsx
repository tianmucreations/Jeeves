import React, { useEffect, useRef, useState } from 'react';
import { Text } from 'ink';
import chalk from 'chalk';
import notifier from 'node-notifier';
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

async function notifyJobFinished(seconds: number): Promise<void> {
  try {
    if (await isTerminalFocused()) return;
    notifier.notify({
      title: 'Done',
      message: `The task finished after ${Math.round(seconds)} seconds.`,
    });
  } catch {
    // Notifications are best-effort and must never surface errors.
  }
}

export function TrafficLight() {
  const s = useSession();
  const [pulseTick, setPulseTick] = useState(0);
  const jobStartRef = useRef<number | null>(null);

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

  // Watch for long jobs completing; notify when the terminal is not focused.
  useEffect(() => {
    if (s.status === 'working') {
      if (jobStartRef.current === null) jobStartRef.current = Date.now();
      return;
    }
    if (s.status !== 'idle') return;
    const started = jobStartRef.current;
    jobStartRef.current = null;
    if (started !== null) {
      const seconds = (Date.now() - started) / 1000;
      if (seconds >= 20) void notifyJobFinished(seconds);
    }
  }, [s.status]);

  const color = s.status === 'working' ? PULSE_GREENS[pulseTick] : STATIC_COLORS[s.status];
  return <Text>{chalk.hex(color)(DOT)}</Text>;
}