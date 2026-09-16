import React, { useEffect, useInsertionEffect } from 'react';
import { Box, useStdout } from 'ink';
import { createRequire } from 'node:module';

// Claude Code's alternate-screen takeover, per the published source
// (claude-code-from-source, chapter 13). The ENTER_ALT_SCREEN sequence must
// reach the terminal before the first render frame; useLayoutEffect would be
// too late - the first frame would render to the main screen buffer, producing
// a visible flash before the switch (and macOS Terminal.app would archive that
// frame into the scrollback the instant the app switches). useInsertionEffect
// is the one hook that fires before react-reconciler's resetAfterCommit, where
// Ink triggers the first frame flush.

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
// such method, so the notification lives here: the flag that says the
// alternate screen owns the terminal, consulted by every exit path below.
export function setAltScreenActive(active: boolean, mouseTracking: boolean): void {
  altScreenActive = active;
  // Mouse tracking is deliberately left off: it would break click-drag text
  // selection in Terminal.app, and the app already owns scrolling by key.
  void mouseTracking;
}

// Hands the terminal back. Safe to call from anywhere, any number of times.
// The scrollback erase follows the switch back because macOS Terminal.app
// archives the app's own frames into the scrollback at hand-back (measured),
// and they must not linger; the cursor comes back on for the shell.
export function leaveAltScreen(): void {
  if (!altScreenActive) return;
  altScreenActive = false;
  write(LEAVE_ALT_SCREEN + ERASE_SCROLLBACK + SHOW_CURSOR);
}

// The terminal must always be restored. process handlers per the mechanism,
// plus signal-exit so kill signals re-raise with correct exit codes.
function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  process.on('exit', () => leaveAltScreen());
  process.on('SIGINT', () => {
    leaveAltScreen();
    process.exit(130);
  });
  onSignalExit(() => leaveAltScreen(), { alwaysLast: false });
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

  // The alternate screen has no native scrollback, so the app owns its own
  // scrolling: everything is constrained to the terminal's row count.
  return (
    <Box height={rows} flexDirection="column" overflow="hidden">
      {children}
    </Box>
  );
}