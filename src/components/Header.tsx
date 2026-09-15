import React from 'react';
import { Box, Text } from 'ink';

const BIG_DOT = '▄██▄\n▀██▀';

export function Header() {
  // Phase 1: a terminal cannot scale a single glyph, so the placeholder dot is one solid circle
  // drawn from block characters; the real traffic light arrives in Phase 5.
  return (
    <Box justifyContent="space-between">
      <Text color="cyan">Jeeves</Text>
      <Text bold color="#FF0000">{BIG_DOT}</Text>
    </Box>
  );
}