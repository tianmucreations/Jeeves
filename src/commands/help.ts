import { WORD_JUMP_KEYS } from '../platform/wording.js';

export interface HelpEntry {
  command: string;
  description: string;
}

export const COMMANDS: HelpEntry[] = [
  { command: '/help', description: 'show this list' },
  { command: '/model', description: 'pick a different AI model' },
  { command: '/keys', description: 'add or remove keys' },
  { command: '/folder', description: 'work in a different folder, or just chat' },
  { command: '/address', description: 'change how Jeeves addresses you' },
  { command: '/verbose', description: "show the model's thinking and technical details" },
  { command: '/undo', description: 'put the project folder back to how it was before the last change' },
  { command: '/ask', description: 'ask before every change in this project folder again (after "always allow")' },
  { command: '/clear', description: 'start a fresh conversation and clear the screen' },
  { command: '/exit', description: 'quit' },
];

export const KEY_BINDINGS: HelpEntry[] = [
  { command: 'up down', description: 'move in lists' },
  { command: 'Enter', description: 'select' },
  { command: 'Esc', description: 'go back' },
  { command: 'Ctrl+R', description: "show the model's last thinking" },
  { command: 'y / n', description: 'allow or deny a permission request' },
  { command: '↑ ↓', description: 'scroll the conversation up and down; Page Up / Page Down jump a whole screen; End returns to the newest' },
  { command: '← →', description: `move the cursor in what you are typing; ${WORD_JUMP_KEYS} jump a word; Ctrl+A / Ctrl+E go to the start / end; or click where you want it` },
  { command: 'wheel', description: 'the trackpad or mouse wheel scrolls the conversation too' },
  { command: 'copying', description: 'drag over any text - it is copied when you let go' },
];