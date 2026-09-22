// One screen with everything in it, grouped into categories, instead of having to
// remember the separate slash commands (the owner asked for this directly). Each
// item runs the exact command it names - the same thing typing it would do - so
// nothing here duplicates any screen's own logic.
export type SettingsRow =
  | { kind: 'header'; title: string }
  | { kind: 'item'; label: string; hint: string; command: string };

export const SETTINGS_ROWS: SettingsRow[] = [
  { kind: 'header', title: 'FOLDERS' },
  { kind: 'item', label: 'Change folder', hint: 'work in a different folder, or just chat', command: '/folder' },

  { kind: 'header', title: 'AI SERVICE & MODELS' },
  { kind: 'item', label: 'Choose AI service and model', hint: 'pick what Jeeves uses to answer', command: '/model' },
  { kind: 'item', label: 'Manage keys', hint: 'connect an AI service, or remove one', command: '/keys' },

  { kind: 'header', title: 'YOU' },
  { kind: 'item', label: 'How I address you', hint: "Sir, Ma'am, or a name", command: '/address' },

  { kind: 'header', title: 'CONVERSATION' },
  { kind: 'item', label: 'Start a fresh conversation', hint: 'clears what Jeeves remembers so far', command: '/clear' },
  { kind: 'item', label: "Undo Jeeves's last change", hint: 'puts the folder back to how it was', command: '/undo' },
  { kind: 'item', label: 'Show technical details', hint: 'for curious people', command: '/verbose' },

  { kind: 'header', title: 'HELP' },
  { kind: 'item', label: 'Full help and keyboard shortcuts', hint: '', command: '/help' },

  { kind: 'header', title: 'QUIT' },
  { kind: 'item', label: 'Exit Jeeves', hint: '', command: '/exit' },
];

export const SETTINGS_ITEMS: Extract<SettingsRow, { kind: 'item' }>[] = SETTINGS_ROWS.filter(
  (row): row is Extract<SettingsRow, { kind: 'item' }> => row.kind === 'item'
);
