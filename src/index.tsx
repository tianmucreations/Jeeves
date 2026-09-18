import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { App } from './app.js';
import { session } from './state/session.js';
import { AlternateScreen, leaveAltScreen } from './ink/AlternateScreen.js';
import { killAllRunningCommands } from './tools/runBash.js';
import { getAddress } from './platform/config.js';

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

// The version comes from package.json, so it can never drift from the release.
function packageVersion(): string {
  try {
    const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'package.json');
    return (JSON.parse(readFileSync(file, 'utf8')) as { version?: string }).version ?? 'unknown';
  } catch {
    return 'unknown';
  }
}

const program = new Command();

program
  .name('jeeves')
  .version(packageVersion())
  .description('A plain-English terminal assistant.')
  .argument('[prompt]', 'optional prompt to start with')
  .action((prompt) => {
    // Graceful degradation: without an interactive terminal there is nothing to draw,
    // so explain in plain English instead of crashing on raw mode. (Checked here, not
    // earlier, so --version and --help still answer anywhere.)
    if (!process.stdin.isTTY) {
      console.error('This needs to be opened in a Terminal window.');
      process.exit(1);
    }
    // The address question comes before the project picker on first launch only;
    // a saved address skips straight to the picker.
    if (getAddress()) session.skipAddressStage();
    // The prompt argument is accepted but not auto-sent yet; a later phase wires it into the loop.
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
          killAllRunningCommands();
          leaveAltScreen();
          process.exit(0);
        });
      }
    });
  });

program.parse();