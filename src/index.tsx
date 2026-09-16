import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { existsSync } from 'node:fs';
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

const program = new Command();

program
  .name('jeeves')
  .version('0.1.0')
  .description('A plain-English terminal assistant.')
  .argument('[prompt]', 'optional prompt to start with')
  .action((prompt) => {
    // The prompt argument is accepted but not auto-sent yet; a later phase wires it into the loop.
    // The alternate screen is the same mechanism vim and less use: Jeeves takes over the whole
    // window, and the shell's own history is restored untouched on exit.
    const instance = render(<App />, { alternateScreen: true });
    // /exit asks for a clean shutdown: restore the terminal first, then leave.
    session.subscribe(() => {
      if (session.exitRequested) {
        instance.unmount();
        void instance.waitUntilExit().then(() => process.exit(0));
      }
    });
  });

program.parse();