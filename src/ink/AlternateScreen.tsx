// ─────────────────────────────────────────────────────────────────────────────
// DO NOT CHANGE THE HOOK. THE TAKEOVER MUST STAY INSIDE useInsertionEffect.
// ─────────────────────────────────────────────────────────────────────────────
// This component implements Claude Code's alternate-screen takeover (published
// source: alejandrobalderas/claude-code-from-source, chapter 13). The
// ENTER_ALT_SCREEN escape sequence must reach the terminal BEFORE the first
// render frame is flushed. react-reconciler calls resetAfterCommit between the
// mutation and layout commit phases, and Ink's resetAfterCommit triggers the
// first onRender - the first frame write to the terminal.
//
// useLayoutEffect and useEffect both run AFTER that first onRender. "Upgrade"
// this to either hook and the first frame paints to the MAIN screen buffer,
// producing a visible flash before the switch - and macOS Terminal.app then
// archives that pre-app frame into its scrollback at the moment the app
// switches, so the shell history stays reachable by scrolling forever. That is
// the exact bug this file exists to prevent; it took days to diagnose and the
// answer was published all along. Only useInsertionEffect fires before
// resetAfterCommit. This is not a stylistic choice. Do not "improve" it.
//
// The escape order is equally deliberate: 1049h (take over the window) → 2J
// (clear the fresh alternate screen) → 3J (erase the scrollback the switch
// archived) → H (home the cursor), in one write. Entering first means the main
// screen is never wiped, so quitting restores the shell's own screen exactly.
// Ink's built-in alternateScreen render option is NOT used: it is not needed
// here and mixing the two mechanisms invites double switches.
// ─────────────────────────────────────────────────────────────────────────────

import React, { useEffect, useInsertionEffect } from 'react';
import { Box, useStdout } from 'ink';
import { createRequire } from 'node:module';
import { DEFAULT_CURSOR } from './cursor.js';
import { killAllRunningCommands } from '../tools/runBash.js';

type SignalExit = (
  callback: (code: number | null, signal: string | null) => void,
  options?: { alwaysLast?: boolean }
) => () => void;

// signal-exit covers the termination signals beyond exit and SIGINT
// (SIGTERM, SIGHUP) with correct exit codes. Already in the tree as Ink's own
// dependency; declared ours.
const onSignalExit = createRequire(import.meta.url)('signal-exit') as SignalExit;

const ENTER_ALT_SCREEN = '\x1b[?1049h';
const CLEAR_SCREEN = '\x1b[2J';
const ERASE_SCROLLBACK = '\x1b[3J';
const HOME_CURSOR = '\x1b[H';
const LEAVE_ALT_SCREEN = '\x1b[?1049l';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';

let altScreenActive = false;
let cleanupRegistered = false;

function write(data: string): void {
  try {
    process.stdout.write(data);
  } catch {
    // A closed stream must never crash the takeover or the exit path.
  }
}

// Claude Code's Ink fork exposes this on the render instance; stock Ink has no
// such method, so the notification lives here: the flag that says the alternate
// screen owns the terminal, consulted by every exit path below. The mouseTracking
// parameter keeps the fork-shaped API; the app does not enable mouse reporting
// (copy-on-select was reverted - the terminal's own selection is used instead).
export function setAltScreenActive(active: boolean, mouseTracking: boolean): void {
  altScreenActive = active;
  void mouseTracking;
}

// Hands the terminal back. Safe to call from anywhere, any number of times.
// The scrollback erase follows the switch back because macOS Terminal.app
// archives the app's own frames into the scrollback at hand-back (measured),
// and the cursor shape returns to the shell default with the cursor back on.
export function leaveAltScreen(): void {
  if (!altScreenActive) return;
  altScreenActive = false;
  write(LEAVE_ALT_SCREEN + ERASE_SCROLLBACK + DEFAULT_CURSOR + SHOW_CURSOR);
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
  const { stdout } = useStdout();

  // Entered once, before the first frame, in Claude Code's order: take over
  // the window first, then clear the fresh alternate screen, erase the
  // scrollback the switch archived, and home the cursor. Because the main
  // screen is never wiped, the shell's own screen survives for a perfect
  // restore on exit. The cursor is hidden for the same reason Ink's own mode
  // hides it. Empty dependency array: this runs exactly once, on mount.
  useInsertionEffect(() => {
    write(ENTER_ALT_SCREEN + CLEAR_SCREEN + ERASE_SCROLLBACK + HOME_CURSOR + HIDE_CURSOR);
    setAltScreenActive(true, false);
    registerCleanup();
  }, []);

  // On unmount the terminal is handed back too (the app unmounts before the
  // process exits on /exit and Ctrl+C).
  useEffect(() => {
    return () => leaveAltScreen();
  }, []);

  const rows = Math.max(stdout.rows ?? 24, 8);

  // The ceiling: without a height constraint on this box, flexGrow below has no
  // limit - the viewport would size to the content, scrolling would pin at 0, and
  // Ink's screen buffer would size to the full content. This is what makes the
  // slot layout work. The alternate screen has no native scrollback, so the app
  // owns its scrolling within these rows.
  return (
    <Box height={rows} flexDirection="column">
      {children}
    </Box>
  );
}