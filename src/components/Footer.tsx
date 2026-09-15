import React from 'react';
import { Box, Text } from 'ink';
import { useSession } from '../state/session.js';

export function Footer() {
  const s = useSession();
  return (
    <Box justifyContent="space-between">
      <Text dimColor>{s.model}</Text>
      <Text dimColor>
        in {s.tokensIn} · out {s.tokensOut} tokens
      </Text>
    </Box>
  );
}