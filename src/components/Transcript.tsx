import React, { useMemo, useRef } from 'react';
import { Box, Text, useBoxMetrics, useStdout, type DOMElement } from 'ink';
import { useSession, type TranscriptEntry } from '../state/session.js';
import { buildDisplayLines } from './transcript-layout.js';

// Claude Code's ScrollBox pattern (ch13-14-terminal-ui.md): the outer box clips at
// the viewport with overflow="hidden" and flexGrow={1}, so the transcript fills
// every row left over by the fixed header, input, and footer slots - no dead space.
// The inner box slides the whole content up with a negative top margin as the user
// scrolls; scrollTop is clamped between 0 and contentHeight - viewportHeight, both
// measured live. While scrollTop is 0 the newest line sits at the bottom edge
// (auto-follow): new content arrives and the view stays pinned to it.
export function Transcript({ width }: { width: number }) {
  const s = useSession();
  const { stdout } = useStdout();
  const outer = useRef<DOMElement | null>(null);
  const inner = useRef<DOMElement | null>(null);
  const viewport = useBoxMetrics(outer);
  const content = useBoxMetrics(inner);

  const entries = useMemo<TranscriptEntry[]>(() => {
    if (s.showLastReasoning && s.lastReasoning) {
      return [...s.transcript, { id: -1, kind: 'reasoning', text: s.lastReasoning }];
    }
    return s.transcript;
  }, [s.transcript, s.showLastReasoning, s.lastReasoning]);

  const lines = useMemo(() => buildDisplayLines(entries, width), [entries, width]);

  // Virtual scroll: never above the first line, never below the newest.
  const maxScroll = Math.max(0, content.height - viewport.height);
  const scrollTop = Math.min(s.transcriptScrollUp, maxScroll);

  return (
    <Box flexDirection="column" overflow="hidden" flexGrow={1} justifyContent="flex-end" ref={outer}>
      <Box flexDirection="column" flexShrink={0} marginTop={-scrollTop} ref={inner}>
        {lines.map((line, index) => (
          <Text key={index} color={line.color} dimColor={line.dim}>
            {line.text}
          </Text>
        ))}
      </Box>
    </Box>
  );
}