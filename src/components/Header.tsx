import React from 'react';
import { Box, Text } from 'ink';
import { TrafficLight } from './TrafficLight.js';

// The name in Tianmu Creations gold (tianmucreations.com's --gold), as in the desktop
// window. A terminal keeps its own font, so only the colour can match; Terminal.app
// shows the nearest of its 256 colours.
export const BRAND_GOLD = '#c9a96a';

export function Header() {
  return (
    <Box justifyContent="space-between">
      <Text color={BRAND_GOLD} bold>Jeeves</Text>
      <TrafficLight />
    </Box>
  );
}