import React from 'react';
import { Box, Text } from 'ink';
import chalk from 'chalk';
import { useSession, type Status } from '../state/session.js';

const DOT_COLORS: Record<Status, string> = {
  idle: '#FF0000',
  working: '#00FF00',
  'awaiting-approval': '#FFB000',
  disconnected: '#808080',
};

export function Header() {
  const s = useSession();
  const dot = chalk.hex(DOT_COLORS[s.status])('⬤');
  return (
    <Box justifyContent="space-between">
      <Text color="cyan">Jeeves</Text>
      <Text>{dot}</Text>
    </Box>
  );
}