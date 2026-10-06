import React from 'react';
import { Box, Text, useInput } from '../vendor/ink/index.js';
import { useSession } from '../state/session.js';

// Plain-English help: what Jeeves does and where the buttons are. No typed commands -
// nobody should need to know one (owner, 30 Sept: "it has to be simple").
const LINES: { label: string; text: string }[] = [
  { label: 'Ask', text: 'Just say what you want in plain words and press Enter. I do it, and ask before changing anything.' },
  { label: 'Settings', text: 'The button at the bottom left: pick a folder, choose the AI and its model, connect a key, go back to an earlier conversation, undo my last change.' },
  { label: 'Picture', text: 'The button beside Settings: show me a picture or screenshot. You can also paste one or drop the file on this window.' },
  { label: 'Questions', text: 'Before I change something I ask. Click Allow, Always Allow or Decline. When I offer choices, click one or type your own answer.' },
  { label: 'Stop', text: 'Press Esc any time to stop what I am doing.' },
  { label: 'Copy', text: 'Drag over text with the mouse (or double-click a word); it is copied when you let go.' },
  { label: 'Earlier', text: 'Up arrow in an empty box brings back what you sent before.' },
];

export function HelpView({ rows }: { rows: number }) {
  const s = useSession();

  useInput((input, key) => {
    if (key.escape || key.return) {
      s.closeHelp();
    }
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>Help - what I can do</Text>
      <Box flexDirection="column" flexGrow={1} justifyContent="center">
        {LINES.map((line) => (
          // Long text wraps under itself, not under the label.
          <Box key={line.label}>
            <Box width={11} flexShrink={0}>
              <Text>{' ' + line.label}</Text>
            </Box>
            <Text dimColor wrap="wrap">
              {line.text}
            </Text>
          </Box>
        ))}
      </Box>
      <Text dimColor>Esc close</Text>
    </Box>
  );
}
