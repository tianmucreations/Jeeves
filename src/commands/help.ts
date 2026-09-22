import { WORD_JUMP_KEYS } from '../platform/wording.js';

export interface HelpEntry {
  command: string;
  description: string;
}

export const COMMANDS: HelpEntry[] = [
  { command: '/help', description: 'show this list' },
  { command: '/model', description: 'choose the AI service and model' },
  { command: '/keys', description: 'connect an AI service, or remove one' },
  { command: '/folder', description: 'work in a different folder, or just chat' },
  { command: '/undo', description: "put the folder back to how it was before Jeeves's last change" },
  { command: '/ask', description: 'ask before every change again (after "always allow")' },
  { command: '/clear', description: 'start a fresh conversation' },
  { command: '/address', description: 'change how Jeeves addresses you' },
  { command: '/verbose', description: 'show technical details as well (for curious people)' },
  { command: '/exit', description: 'quit' },
];

export const KEY_BINDINGS: HelpEntry[] = [
  { command: 'Enter', description: 'send your message, or choose in a list' },
  { command: 'Esc', description: 'stop what Jeeves is doing, or go back' },
  { command: 'Ctrl+C', description: 'clear what you are typing or stop Jeeves; press it twice to quit' },
  { command: 'y / a / n', description: 'answer a question: yes, always allow in this folder, or no - or click a button, or use ← → and Enter' },
  { command: '↑ ↓', description: 'move in a list, or scroll the conversation; Page Up / Page Down jump a whole screen; End returns to the newest' },
  { command: '← →', description: `move the cursor in what you are typing; ${WORD_JUMP_KEYS} jump a word; Ctrl+A / Ctrl+E go to the start / end; or click where you want it` },
  { command: 'copying', description: 'drag over any text - it is copied when you let go' },
  { command: 'Ctrl+R', description: 'show the notes Jeeves made while thinking about the last answer' },
];
