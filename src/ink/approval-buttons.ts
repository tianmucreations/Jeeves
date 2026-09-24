// A row of approval "buttons" for the terminal, the same idea as OpenCode's
// clickable permission row (packages/tui/src/routes/session/permission.tsx):
// a mouse click and the keyboard both land on the same answer. Labels match
// Jeeves Desktop's own buttons exactly, so the two feel like one product.
export interface ApprovalButton {
  key: 'y' | 'a' | 'n' | 'c';
  label: string;
  start: number; // column offset from the start of the rendered line
  end: number; // exclusive
}

const SEPARATOR = '   ';

// For a command question the row carries the new "always allow this kind"
// answer (as Claude Code's "don't ask again for wc commands"): the labels drop
// the letter hints there so four buttons still fit in 80 columns - the letters
// keep working either way.
export function approvalButtons(trustable: boolean, commandFamily: string | null = null): ApprovalButton[] {
  let specs: Array<{ key: ApprovalButton['key']; label: string }>;
  if (commandFamily) {
    specs = [
      { key: 'y', label: 'Allow' },
      { key: 'c', label: `Always allow ${commandFamily}` },
      ...(trustable ? [{ key: 'a' as const, label: 'Always this project' }] : []),
      { key: 'n', label: "Don't allow" },
    ];
  } else {
    specs = trustable
      ? [
          { key: 'y', label: 'Allow (y)' },
          { key: 'a', label: 'Always allow in this project (a)' },
          { key: 'n', label: "Don't allow (n)" },
        ]
      : [
          { key: 'y', label: 'Allow (y)' },
          { key: 'n', label: "Don't allow (n)" },
        ];
  }
  let cursor = 0;
  return specs.map((spec, index) => {
    if (index > 0) cursor += SEPARATOR.length;
    const start = cursor;
    cursor += spec.label.length;
    return { key: spec.key, label: spec.label, start, end: cursor };
  });
}

// Which button (if any) a click at this column landed on.
export function approvalButtonAt(buttons: ApprovalButton[], column: number): ApprovalButton | null {
  return buttons.find((button) => column >= button.start && column < button.end) ?? null;
}
