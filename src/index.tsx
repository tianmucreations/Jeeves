import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './app.js';
import { session } from './state/session.js';

// Local development bridge: settings such as OPENROUTER_API_KEY are loaded from a gitignored
// .env file at the project root. Replaced by the secure OS credential store in Phase 7.
const envPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '.env');
if (existsSync(envPath)) {
  try {
    process.loadEnvFile(envPath);
  } catch {
    // A malformed .env is non-fatal; the on-screen notice explains what is missing.
  }
}

// Graceful degradation: without an interactive terminal there is nothing to draw,
// so explain in plain English instead of crashing on raw mode.
if (!process.stdin.isTTY) {
  console.error('This app needs an interactive terminal window to run.');
  process.exit(1);
}

// The alternate screen is entered once for the whole process - before the project picker,
// before the first frame, before anything draws - and left only when Jeeves quits entirely.
// macOS Terminal.app has a quirk at the centre of this: the moment an app switches to the
// alternate screen, Terminal.app archives the whole pre-app screen (visible viewport AND its
// scrollback) where its scroll gesture can still reach it. So "the shell disappears" - the
// spec's requirement - only becomes true if the pre-app screen is wiped first:
// 2J+H = clear the visible main screen and home the cursor (nothing left to archive).
// 3J = erase the scrollback that scrolled off earlier in the shell's life.
// 1049h = take over the whole window (the vim mechanism).
// 2J+H = clear the fresh alternate screen and home the cursor.
// 1049l = hand the terminal back: the shell prints a fresh prompt on a clean screen.
// The cost of the wipe is honest and deliberate: the pre-app banner lines are gone for good,
// because keeping them is exactly what makes them scrollable. Writing the takeover by hand
// also guarantees it happens even if the UI library's own switch were ever skipped, and the
// duplicate enter/leave pairs with the library's are harmless (xterm keeps one saved cursor
// per screen, so the shell's cursor position survives both switches).
const ENTER_ALT_SCREEN = '\x1b[2J\x1b[H\x1b[3J\x1b[?1049h\x1b[2J\x1b[H';
const LEAVE_ALT_SCREEN = '\x1b[?1049l\x1b[?25h';

function restoreTerminal(): void {
  try {
    process.stdout.write(LEAVE_ALT_SCREEN);
  } catch {
    // A closed stream must never crash the exit path.
  }
}

// Optional runtime diagnostics: set JEEVES_DEBUG_ESCAPES=/path/to/log and every byte
// written to stdout is mirrored to that file with escape sequences made visible.
// Logs to a file only - never to the screen - so it cannot disturb the display.
function installEscapeLogger(): void {
  const logFile = process.env.JEEVES_DEBUG_ESCAPES;
  if (!logFile) return;
  const original = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: unknown, ...rest: unknown[]) => {
    try {
      const visible = String(chunk)
        .replace(/\x1b/g, '<ESC>')
        .replace(/\r/g, '<CR>')
        .replace(/\n/g, '<LF>\n');
      appendFileSync(logFile, `${new Date().toISOString()} WRITE ${visible}\n`);
    } catch {
      // Diagnostics must never break the app.
    }
    return original(chunk as string, ...(rest as [never]));
  }) as typeof process.stdout.write;
}

const program = new Command();

program
  .name('jeeves')
  .version('0.2.0')
  .description('A plain-English terminal assistant.')
  .argument('[prompt]', 'optional prompt to start with')
  .action((prompt) => {
    // The prompt argument is accepted but not auto-sent yet; a later phase wires it into the loop.
    installEscapeLogger();
    // Enter the alternate screen by hand, before anything can draw, so the shell's
    // history is invisible from the very first frame onwards.
    try {
      process.stdout.write(ENTER_ALT_SCREEN);
    } catch {
      // If the terminal cannot be taken over, Ink below still handles rendering.
    }
    const instance = render(<App />, { alternateScreen: true });
    let quitting = false;
    // /exit is graceful: Ink finishes its frame teardown, then the terminal is handed back.
    const shutdownGraceful = (): void => {
      if (quitting) return;
      quitting = true;
      instance.unmount();
      void instance.waitUntilExit().then(() => {
        restoreTerminal();
        process.exit(0);
      });
    };
    // Signals are abrupt: restore the terminal synchronously before anything else,
    // because a killed process may never get to run async cleanup.
    const shutdownNow = (): void => {
      if (quitting) return;
      quitting = true;
      instance.unmount();
      restoreTerminal();
      process.exit(0);
    };
    // /exit asks for a clean shutdown: restore the terminal first, then leave.
    session.subscribe(() => {
      if (session.exitRequested) shutdownGraceful();
    });
    process.on('SIGINT', shutdownNow);
    process.on('SIGTERM', shutdownNow);
    process.on('SIGHUP', shutdownNow);
    process.on('exit', () => restoreTerminal());
  });

program.parse();