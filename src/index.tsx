import React from 'react';
import { render } from 'ink';
import { Command } from 'commander';
import { App } from './app.js';

const program = new Command();

program
  .name('jeeves')
  .version('0.1.0')
  .description('A plain-English terminal assistant.')
  .argument('[prompt]', 'optional prompt to start with')
  .action((prompt) => {
    // Phase 1 scaffold: the prompt argument is accepted but unused until the agent loop exists (Phase 2).
    render(<App />);
  });

program.parse();