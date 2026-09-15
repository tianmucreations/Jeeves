import React from 'react';
import { Box, Text } from 'ink';
import { useSession } from '../state/session.js';

export function Transcript() {
  const s = useSession();
  return (
    <Box flexDirection="column">
      {s.transcript.map((entry) => {
        if (entry.kind === 'user') {
          return (
            <Text key={entry.id}>
              <Text dimColor>{'> '}</Text>
              {entry.text}
            </Text>
          );
        }
        if (entry.kind === 'error') {
          return (
            <Text key={entry.id} color="red">
              {entry.text}
            </Text>
          );
        }
        if (entry.kind === 'notice') {
          return (
            <Text key={entry.id} color="yellow">
              {entry.text}
            </Text>
          );
        }
        return <Text key={entry.id}>{entry.text}</Text>;
      })}
      {s.transcript.length === 0 && <Text dimColor> </Text>}
    </Box>
  );
}