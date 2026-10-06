// ─────────────────────────────────────────────────────────────────────────────
// THE TERMINAL HANDSHAKE — normal-buffer edition (3 Oct).
//
// Until today this component took over the whole window (the "alternate
// screen"): Jeeves drew every row itself and the terminal's own scrollback was
// unreachable — which is why he could never scroll back with his trackpad
// while an answer printed, no matter how often it was "fixed". Claude Code
// does NOT take the window: it prints finished text into the terminal's own
// history and keeps only a small live block at the bottom. That is what
// Jeeves does now, so this component is the normal-buffer handshake:
//
//   • the hardware cursor is hidden (Jeeves draws its own inside the frame)
//     and restored on the way out;
//   • mouse reporting starts OFF — in the plain conversation the wheel and
//     the scrollbar belong to the TERMINAL (native scrolling, native
//     select-and-copy); the app turns mouse reporting on only where there is
//     something to click (a question, the Allow buttons, a list screen);
//   • the exit paths (Ctrl+C, /exit, kill signals) always restore both, and
//     always kill the commands the agent started.
//
// The old takeover had to run inside useInsertionEffect so the switch reached
// the terminal before the first frame; the normal buffer has no such ordering
// trap — a plain mount effect is enough. The export names are unchanged so
// every exit path keeps calling the same functions.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect } from 'react';
import { Box } from '../vendor/ink/index.js';
import { createRequire } from 'node:module';
import { DEFAULT_CURSOR } from './cursor.js';
import { DISABLE_MOUSE_TRACKING } from './mouse.js';
import { killAllRunningCommands } from '../tools/runBash.js';

type SignalExit = (
  callback: (code: number | null, signal: string | null) => void,
  options?: { alwaysLast?: boolean }
) => () => void;

// signal-exit covers the termination signals beyond exit and SIGINT
// (SIGTERM, SIGHUP) with correct exit codes. Already in the tree as Ink's own
// dependency; declared ours.
const onSignalExit = createRequire(import.meta.url)('signal-exit') as SignalExit;

const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

let cleanupRegistered = false;

function write(data: string): void {
  try {
    process.stdout.write(data);
  } catch {
    // A closed stream must never crash the handshake or the exit path.
  }
}

// Kept for the callers that report the old takeover state; in the normal
// buffer the app never owns the whole screen, so this only records the mouse
// report state truthfully.
export function setAltScreenActive(active: boolean, mouseTracking: boolean): void {
  void active;
  void mouseTracking;
}

// Hands the terminal back exactly as the shell left it: mouse reports off (so
// selection, Cmd+C and the scrollbar are the terminal's own again), the cursor
// back to its default shape and visible. Safe from anywhere, any number of times.
export function leaveAltScreen(): void {
  write(DISABLE_MOUSE_TRACKING + DEFAULT_CURSOR + SHOW_CURSOR);
}

// The terminal must always be restored, and any command the agent is running
// must die with the app - the user is leaving, nothing may keep running or block
// the exit. process handlers per the mechanism, plus signal-exit so kill signals
// re-raise with correct exit codes.
function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.on('exit', () => {
    killAllRunningCommands();
    leaveAltScreen();
  });
  process.on('SIGINT', () => {
    killAllRunningCommands();
    leaveAltScreen();
    process.exit(130);
  });
  onSignalExit(() => {
    killAllRunningCommands();
    leaveAltScreen();
  }, { alwaysLast: false });
}

export function AlternateScreen({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    write(HIDE_CURSOR);
    registerCleanup();
    // The unmount path restores the terminal too (the app unmounts before the
    // process exits on /exit and Ctrl+C).
    return () => leaveAltScreen();
  }, []);

  // In the normal buffer the app does not own the window, so the children are
  // rendered as they come: finished text is flushed to the terminal's history
  // by <Static>, and the small live block sits under it.
  return <>{children}</>;
}
