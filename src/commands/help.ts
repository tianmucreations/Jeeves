export interface HelpEntry {
  command: string;
  description: string;
}

export const COMMANDS: HelpEntry[] = [
  { command: '/help', description: 'show this list' },
  { command: '/model', description: 'pick a different AI model' },
  { command: '/keys', description: 'add or remove API keys' },
  { command: '/verbose', description: "show the model's thinking on screen" },
  { command: '/clear', description: 'start a fresh conversation and clear the screen' },
  { command: '/exit', description: 'quit' },
];

export const KEY_BINDINGS: HelpEntry[] = [
  { command: 'up down', description: 'move in lists' },
  { command: 'Enter', description: 'select' },
  { command: 'Esc', description: 'go back' },
  { command: 'Tab', description: 'zoom a footer bar' },
  { command: 'Ctrl+R', description: "show the model's last thinking" },
  { command: 'y / n', description: 'allow or deny a permission request' },
];