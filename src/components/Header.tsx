import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';

export function Header() {
  // Phase 1: U+2B24 is the largest single round glyph a terminal can show; the real traffic light arrives in Phase 5.
  const dot = chalk.hex('#FF0000')('⬤');
  return (
    <Box justifyContent="space-between">
      <Text color="cyan">Jeeves</Text>
      <Text>{dot}</Text>
    </Box>
  );
}