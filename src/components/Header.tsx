import React from 'react';
import { Box, Text } from 'ink';

export function Header() {
  // Phase 1: static dot placeholder; the pulsing traffic light arrives in Phase 5.
  return (
    <Box justifyContent="space-between">
      <Text color="cyan">Jeeves</Text>
      <Text bold color="red">●●●</Text>
    </Box>
  );
}