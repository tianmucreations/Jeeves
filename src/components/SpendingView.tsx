import React from 'react';
import { Box, Text, useInput } from 'ink';
import { session } from '../state/session.js';
import { spendingLines } from '../commands/spending.js';

// "What I've spent": read-only, plain words. Esc or Enter goes back.
export function SpendingView({ rows }: { rows: number }) {
  useInput((input, key) => {
    if (key.escape || key.return) session.closeSpending();
  });
  const lines = spendingLines();
  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor bold>WHAT I'VE SPENT</Text>
      <Box flexDirection="column" flexGrow={1}>
        {lines.map((line, index) =>
          line.heading ? (
            <React.Fragment key={index}>
              {index > 0 ? <Text> </Text> : null}
              <Text bold>{` ${line.label}`}</Text>
            </React.Fragment>
          ) : (
            <Text key={index} wrap="truncate-end">
              {` ${line.label}`.padEnd(32)}
              <Text dimColor>{line.value}</Text>
            </Text>
          )
        )}
      </Box>
      <Text dimColor>Esc back</Text>
    </Box>
  );
}
