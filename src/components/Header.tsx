import React from 'react';
import { Box, Text } from 'ink';
import { TrafficLight } from './TrafficLight.js';

export function Header() {
  return (
    <Box justifyContent="space-between">
      <Text color="cyan">Jeeves</Text>
      <TrafficLight />
    </Box>
  );
}