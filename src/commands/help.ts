import { WORD_JUMP_KEYS } from '../platform/wording.js';
import { COMMAND_TABLE } from './registry.js';

export interface HelpEntry {
  command: string;
  description: string;
  // What the Settings list calls it: plain words, never the typed command.
  label?: string;
}

// Derived from the one list of commands (registry.ts).
export const COMMANDS: (HelpEntry & { place?: 'conversation' | 'more'; window?: 'settings' | 'help' | 'folder' | 'exit' })[] = COMMAND_TABLE.map(
  ({ command, label, description, place, window }) => ({ command, label, description, place, window })
);

export const KEY_BINDINGS: HelpEntry[] = [
  { command: 'Enter', description: 'send your message, or choose in a list' },
  { command: 'Esc', description: 'stop what Jeeves is doing, or go back' },
  { command: 'Ctrl+C', description: 'clear what you are typing or stop Jeeves; press it twice to quit' },
  { command: 'y / a / n', description: 'answer a question: yes, always allow in this folder, or no - or click a button, or use ← → and Enter' },
  { command: '↑ ↓', description: 'at an empty box, walk back through your previous messages (Down comes forward again); any other time they scroll the conversation - the wheel or trackpad scrolls too, and over the typing box, a long message; Page Up / Page Down jump a whole screen; End returns to the newest' },
  { command: '← →', description: `move the cursor in what you are typing; ${WORD_JUMP_KEYS} jump a word; Ctrl+A / Ctrl+E go to the start / end; or click where you want it` },
  { command: 'copying', description: 'drag over text, or double-click a word or triple-click a line - it is copied when you let go' },
  { command: 'Ctrl+R', description: 'show the notes Jeeves made while thinking about the last answer' },
];
