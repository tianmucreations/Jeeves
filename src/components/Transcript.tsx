import React, { useEffect, useMemo, useRef } from 'react';
import { Box, Text, useBoxMetrics, useStdout, type DOMElement } from 'ink';
import { session, useSession, type TranscriptEntry } from '../state/session.js';
import { buildDisplayLines, OWN_MESSAGE_BACKGROUND, OWN_MESSAGE_TEXT } from './transcript-layout.js';
import { selectedRange } from '../ink/selection.js';

// Where the conversation sits on screen (1-based): below the top border and the
// header row, one column in past the border and one of padding (app.tsx).
const VIEW_TOP = 3;
const VIEW_LEFT = 3;

// Claude Code's ScrollBox pattern (ch13-14-terminal-ui.md): the outer box clips at
// the viewport with overflow="hidden" and flexGrow={1}, so the transcript fills
// every row left over by the fixed header, input, and footer slots - no dead space.
// The content is anchored to the bottom (justifyContent flex-end), so the inner box
// scrolls with a negative BOTTOM margin, which pushes it down past the bottom edge
// and brings older lines in at the top. (A negative top margin, as in Claude Code's
// top-anchored ScrollBox, does nothing to a bottom-anchored box - measured with
// renderToString: the same last lines showed at every offset.) scrollTop is
// clamped between 0 and contentHeight - viewportHeight, both measured live. While scrollTop is 0 the newest line sits at the bottom edge
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
  // The session clamps key and wheel scrolling to this same limit.
  useEffect(() => {
    session.setTranscriptScrollMax(maxScroll);
  }, [maxScroll]);
  // The mouse turns a screen position into a line and character with this.
  session.transcriptView = { top: VIEW_TOP, left: VIEW_LEFT, height: viewport.height, lines: lines.map((line) => line.text), scrollTop };

  return (
    <Box flexDirection="column" overflow="hidden" flexGrow={1} justifyContent="flex-end" ref={outer}>
      <Box flexDirection="column" flexShrink={0} marginBottom={-scrollTop} ref={inner}>
        {lines.map((line, index) => {
          // Selected text is drawn reversed, as a terminal's own selection is.
          const range = s.selection ? selectedRange(index, line.text.length) : null;
          return (
            <Text
              key={index}
              color={line.own ? OWN_MESSAGE_TEXT : line.color}
              backgroundColor={line.own ? OWN_MESSAGE_BACKGROUND : undefined}
              dimColor={line.dim}
            >
              {range ? (
                <>
                  {line.text.slice(0, range[0])}
                  <Text inverse>{line.text.slice(range[0], range[1])}</Text>
                  {line.text.slice(range[1])}
                </>
              ) : (
                line.text
              )}
            </Text>
          );
        })}
      </Box>
    </Box>
  );
}