import React from 'react';
import { Text } from 'ink';
import { TrafficLight } from './TrafficLight.js';

// The window's top border, drawn by hand so the name and the dot sit inside the
// border line itself: rounded corner, "─ Jeeves ─" on the left, dashes across,
// the traffic-light dot one column in from the right corner, corner at the end.
// The dot keeps a full dash column to its right so its glyph never touches the
// window edge (the clipped-dot bug) and the corner never shifts.
export function Header({ columns }: { columns: number }) {
  const prefix = '╭─ ';
  const name = 'Jeeves';
  const suffix = '─╮';
  const dashes = Math.max(0, columns - prefix.length - name.length - 1 - 1 - suffix.length);
  return (
    <Text>
      <Text dimColor>{prefix}</Text>
      <Text color="cyan">{name}</Text>
      <Text dimColor> {'─'.repeat(dashes)}</Text>
      <TrafficLight />
      <Text dimColor>{suffix}</Text>
    </Text>
  );
}
