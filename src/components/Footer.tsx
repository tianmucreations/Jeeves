import React from 'react';
import { Box, Text } from 'ink';

export function Footer() {
  return (
    <Box justifyContent="space-between">
      <Text dimColor>no model</Text>
      <Text dimColor>0 tok/min</Text>
    </Box>
  );
}