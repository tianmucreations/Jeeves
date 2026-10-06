import React from 'react';
import { Text, type Key } from 'ink';

// A row of real buttons for a terminal screen, so a click can do everything a key can (owner, 30 Sept: "some
// things I can click, others only the keyboard"). Each button is drawn as a block; `buttonAt` says which one a
// click at a column landed on. Columns count from 1; the row starts at column 1 (screens have no left border).
export interface ButtonSpec {
  label: string;
  run: () => void;
}

const GAP = 2;

export function ButtonRow({ buttons }: { buttons: ButtonSpec[] }) {
  return (
    <Text>
      {buttons.map((button, index) => (
        <React.Fragment key={button.label}>
          {index > 0 ? ' '.repeat(GAP) : ''}
          <Text color="yellow" inverse>{` ${button.label} `}</Text>
        </React.Fragment>
      ))}
    </Text>
  );
}

export function buttonAt(buttons: ButtonSpec[], col: number): ButtonSpec | null {
  let start = 1;
  for (const button of buttons) {
    const width = button.label.length + 2;
    if (col >= start && col < start + width) return button;
    start += width + GAP;
  }
  return null;
}

// A key press made by a click: the buttons do exactly what the key does, by calling the screen's own key handler.
const KEY_NAMES = ['upArrow', 'downArrow', 'leftArrow', 'rightArrow', 'pageDown', 'pageUp', 'home', 'end', 'return', 'escape', 'ctrl', 'shift', 'tab', 'backspace', 'delete', 'meta', 'super', 'hyper', 'capsLock', 'numLock'] as const;
export function keyPress(pressed: Partial<Record<(typeof KEY_NAMES)[number], boolean>>): Key {
  return { ...Object.fromEntries(KEY_NAMES.map((name) => [name, false])), ...pressed } as unknown as Key;
}
