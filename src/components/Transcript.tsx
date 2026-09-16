import React, { useMemo } from 'react';
import { Box, Text } from 'ink';
import { useSession, type TranscriptEntry } from '../state/session.js';
import { buildDisplayLines, visibleWindow } from './transcript-layout.js';

// The transcript is clipped to a fixed height so the frame never grows past the
// terminal window - this is what keeps the header and footer permanently in place.
// The terminal's native scrollback is unavailable in alternate-screen mode, so
// the region scrolls itself: arrow and page keys move the view, and 0 offset
// keeps it pinned to the newest line while answers stream in.
export function Transcript({ height, width }: { height: number; width: number }) {
  const s = useSession();

  const entries = useMemo<TranscriptEntry[]>(() => {
    if (s.showLastReasoning && s.lastReasoning) {
      return [...s.transcript, { id: -1, kind: 'reasoning', text: s.lastReasoning }];
    }
    return s.transcript;
  }, [s.transcript, s.showLastReasoning, s.lastReasoning]);

  const lines = useMemo(() => buildDisplayLines(entries, width), [entries, width]);
  const { visible, linesAbove, linesBelow } = useMemo(
    () => visibleWindow(lines, height, s.transcriptScrollUp),
    [lines, height, s.transcriptScrollUp]
  );

  const showPosition = linesAbove > 0 || linesBelow > 0;

  return (
    <Box flexDirection="column" justifyContent="flex-end" height={height}>
      {showPosition && (
        <Text dimColor>
          ↑ {linesAbove} line{linesAbove === 1 ? '' : 's'} above · newest ↓{linesBelow > 0 ? ` (+${linesBelow} below)` : ''}
        </Text>
      )}
      {visible.map((line, index) => (
        <Text key={index} color={line.color} dimColor={line.dim}>
          {line.text}
        </Text>
      ))}
    </Box>
  );
}