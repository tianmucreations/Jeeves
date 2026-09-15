import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useSession, type TranscriptEntry } from '../state/session.js';
import { buildDisplayLines } from './transcript-layout.js';

// The transcript is clipped to a fixed height so the frame never grows past the
// terminal window - this is what keeps the header and footer permanently in place.
export function Transcript({ height, width }: { height: number; width: number }) {
  const s = useSession();

  const entries = useMemo<TranscriptEntry[]>(() => {
    if (s.showLastReasoning && s.lastReasoning) {
      return [...s.transcript, { id: -1, kind: 'reasoning', text: s.lastReasoning }];
    }
    return s.transcript;
  }, [s.transcript, s.showLastReasoning, s.lastReasoning]);

  const visible = useMemo(
    () => buildDisplayLines(entries, width).slice(-height),
    [entries, width, height]
  );

  return (
    <Box flexDirection="column" justifyContent="flex-end" height={height}>
      {visible.map((line, index) => (
        <Text key={index} color={line.color} dimColor={line.dim}>
          {line.text}
        </Text>
      ))}
    </Box>
  );
}