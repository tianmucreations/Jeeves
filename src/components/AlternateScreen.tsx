import React, { useInsertionEffect } from 'react';
import { Box, useStdout } from 'ink';
import { createRequire } from 'node:module';

// Claude Code's alternate-screen takeover, per the claude-code-from-source
// write-up (book/ch13-terminal-ui.md). The terminal must be switched before the
// first frame is ever flushed: react-reconciler calls resetAfterCommit between
// the mutation and layout commit phases, and Ink's resetAfterCommit triggers
// onRender - the first frame flush. useLayoutEffect and useEffect both run
// after that, so a full frame would land on the main screen first with the
// alternate screen inactive. useInsertionEffect is the one hook that fires
// before it. Ink's built-in alternateScreen option is not used either; this
// component owns the whole mechanism.

type SignalExit = (
  callback: (code: number | null, signal: string | null) => void,
  options?: { alwaysLast?: boolean }
) => () => void;

// signal-exit is the cleanup hook the mechanism prescribes: it runs on process
// exit AND on every termination signal, before the default signal action - so
// the terminal is handed back on every exit path: normal exit, Ctrl+C, SIGTERM,
// hangup. Already present in the tree as Ink's own dependency; declared ours.
const onSignalExit = createRequire(import.meta.url)('signal-exit') as SignalExit;

const CLEAR_SCREEN = '\x1b[2J';
const HOME_CURSOR = '\x1b[H';
const ERASE_SCROLLBACK = '\x1b[3J';
const ENTER_ALT_SCREEN = '\x1b[?1049h';
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
// screen owns the terminal, consulted by every exit path below.
export function setAltScreenActive(active: boolean, mouseTracking: boolean): void {
  altScreenActive = active;
  // Mouse tracking is deliberately left off: it would break click-drag text
  // selection in Terminal.app, and the app already owns scrolling by key.
  void mouseTracking;
}

// Hands the terminal back. Safe to call from anywhere, any number of times.
export function leaveAltScreen(): void {
  if (!altScreenActive) return;
  altScreenActive = false;
  // 1049l restores the shell's screen; the scrollback erase follows because
  // macOS Terminal.app archives the app's own frames into the scrollback the
  // moment the alternate screen is handed back, and they must not linger.
  write(LEAVE_ALT_SCREEN + ERASE_SCROLLBACK + SHOW_CURSOR);
}

// The terminal must be restored on every exit path. Registered once for the
// whole process; the callback fires after Ink's own teardown (registered
// earlier), so frame cleanup lands on the alternate screen before we leave it.
function registerCleanup(): void {
  if (cleanupRegistered) return;
  cleanupRegistered = true;
  onSignalExit(() => leaveAltScreen(), { alwaysLast: false });
}

export function AlternateScreen({ children }: { children: React.ReactNode }) {
  const { stdout } = useStdout();

  // Entered once, before the first frame. Claude Code's order is erase
  // scrollback, clear, home, switch - but macOS Terminal.app implements the
  // clear (2J) by pushing the cleared screen INTO the scrollback, so erasing
  // first lets the shell's last screen survive as scrollable history (measured:
  // the banner came back on scroll). Clearing first and erasing the scrollback
  // second kills both the old history and the clear's own snapshot; on terminals
  // that clear without archiving, both orders are equivalent. The cursor is
  // hidden for the same reason Ink's own mode hides it.
  useInsertionEffect(() => {
    write(CLEAR_SCREEN + HOME_CURSOR + ERASE_SCROLLBACK + ENTER_ALT_SCREEN + HIDE_CURSOR);
    setAltScreenActive(true, false);
    registerCleanup();
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