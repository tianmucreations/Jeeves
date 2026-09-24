// A row of approval "buttons" for the terminal, the same idea as OpenCode's
// clickable permission row (packages/tui/src/routes/session/permission.tsx):
// a mouse click and the keyboard both land on the same answer. Labels match
// Jeeves Desktop's own buttons exactly, so the two feel like one product.
// THE OWNER, 24 SEPT: the buttons are "Allow, Always Allow, Decline" - exactly
// these three words, no letter hints, no command names, nothing else.
export interface ApprovalButton {
  key: 'y' | 'a' | 'n';
  label: string;
  start: number; // column offset from the start of the rendered line
  end: number; // exclusive
}

const SEPARATOR = '   ';

export function approvalButtons(trustable: boolean): ApprovalButton[] {
  const specs: Array<{ key: ApprovalButton['key']; label: string }> = trustable
    ? [
        { key: 'y', label: 'Allow' },
        { key: 'a', label: 'Always Allow' },
        { key: 'n', label: 'Decline' },
      ]
    : [
        { key: 'y', label: 'Allow' },
        { key: 'n', label: 'Decline' },
      ];
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
