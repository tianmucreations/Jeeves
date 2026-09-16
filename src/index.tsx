import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { existsSync, appendFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './app.js';
import { session } from './state/session.js';
import { AlternateScreen, leaveAltScreen } from './ink/AlternateScreen.js';

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
    // The whole app - project picker, key screens, model picker, main window - runs inside a
    // single AlternateScreen, so the terminal is taken over exactly once for the whole
    // process and handed back only when Jeeves quits (Claude Code's mechanism).
    const instance = render(
      <AlternateScreen>
        <App />
      </AlternateScreen>
    );
    let quitting = false;
    // /exit asks for a clean shutdown: let Ink finish its frame teardown, hand the
    // terminal back, then leave.
    session.subscribe(() => {
      if (session.exitRequested && !quitting) {
        quitting = true;
        instance.unmount();
        void instance.waitUntilExit().then(() => {
          leaveAltScreen();
          process.exit(0);
        });
      }
    });
  });

program.parse();