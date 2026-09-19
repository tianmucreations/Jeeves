import React from 'react';
import { Box, Text, useInput } from 'ink';
import { useSession } from '../state/session.js';
import { COMMANDS, KEY_BINDINGS } from '../commands/help.js';

// Plain-English help; every command and key is visible with a one-line description.
export function HelpView({ rows }: { rows: number }) {
  const s = useSession();

  useInput((input, key) => {
        if (key.escape || key.return) {
      s.closeHelp();
    }
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>Help - what you can type</Text>
      <Box flexDirection="column" flexGrow={1} justifyContent="center">
        <Text>Commands</Text>
        {COMMANDS.map((entry) => (
          // Long descriptions wrap under themselves, not under the key.
          <Box key={entry.command}>
            <Box width={11} flexShrink={0}>
              <Text>{' ' + entry.command}</Text>
            </Box>
            <Text dimColor wrap="wrap">
              {entry.description}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Text>Keys</Text>
        {KEY_BINDINGS.map((entry) => (
          // Long descriptions wrap under themselves, not under the key.
          <Box key={entry.command}>
            <Box width={11} flexShrink={0}>
              <Text>{' ' + entry.command}</Text>
            </Box>
            <Text dimColor wrap="wrap">
              {entry.description}
            </Text>
          </Box>
        ))}
        <Text> </Text>
        <Text dimColor>Type anything else in plain English and press Enter - that's all you need.</Text>
      </Box>
      <Text dimColor>Esc close</Text>
    </Box>
  );
}