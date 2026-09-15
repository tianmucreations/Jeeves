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
          <Text key={entry.command}>
            <Text>{' ' + entry.command.padEnd(9)}</Text>
            <Text dimColor>{entry.description}</Text>
          </Text>
        ))}
        <Text> </Text>
        <Text>Keys</Text>
        {KEY_BINDINGS.map((entry) => (
          <Text key={entry.command}>
            <Text>{' ' + entry.command.padEnd(9)}</Text>
            <Text dimColor>{entry.description}</Text>
          </Text>
        ))}
        <Text> </Text>
        <Text dimColor>Type anything else in plain English and press Enter - that's all you need.</Text>
      </Box>
      <Text dimColor>Esc close</Text>
    </Box>
  );
}