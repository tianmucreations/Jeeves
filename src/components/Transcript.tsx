import React, { useEffect, useMemo } from 'react';
import { Box, Text } from 'ink';
import { useSession, type TranscriptEntry } from '../state/session.js';
import { buildDisplayLines, visibleWindow, type DisplayLine } from './transcript-layout.js';
import { registerTranscriptView, transcriptTopRow } from '../ink/mouse.js';

// One transcript row, with the drag-selection range (if any) inverted so the user
// sees exactly what is selected. from/to are inclusive character indices.
function RowText({ line, from, to }: { line: DisplayLine; from: number | null; to: number | null }) {
  if (from === null) {
    return (
      <Text color={line.color} dimColor={line.dim}>
        {line.text}
      </Text>
    );
  }
  const start = Math.max(0, from);
  const end = Math.min(line.text.length, to ?? line.text.length);
  if (start >= end) {
    return (
      <Text color={line.color} dimColor={line.dim}>
        {line.text}
      </Text>
    );
  }
  return (
    <Text color={line.color} dimColor={line.dim}>
      {line.text.slice(0, start)}
      <Text inverse>{line.text.slice(start, end)}</Text>
      {line.text.slice(end)}
    </Text>
  );
}

// The transcript is clipped to a fixed height so the frame never grows past the
// terminal window - this is what keeps the header and footer permanently in place.
// The terminal's native scrollback is unavailable in alternate-screen mode, so
// the region scrolls itself: arrow and page keys move the view, and 0 offset
// keeps it pinned to the newest line while answers stream in. It also publishes
// its rendered rows to the mouse layer so drag-selection maps screen to text.
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
  // The rendered rows the mouse layer must know about: the position indicator
  // (non-selectable, registered as null) followed by the visible lines. The whole
  // block is bottom-aligned inside the fixed-height region.
  const renderedRows = useMemo<(string | null)[]>(
    () => (showPosition ? [null, ...visible.map((line) => line.text)] : visible.map((line) => line.text)),
    [visible, showPosition]
  );
  const firstRow = transcriptTopRow() + Math.max(0, height - renderedRows.length);

  useEffect(() => {
    registerTranscriptView(renderedRows, firstRow);
  }, [renderedRows, firstRow]);

  // Per-row highlight range from the current selection, in rendered-row indices.
  function rowRange(index: number): { from: number; to: number } | null {
    const sel = s.selection;
    if (!sel) return null;
    const startLine = Math.min(sel.startLine, sel.endLine);
    const endLine = Math.max(sel.startLine, sel.endLine);
    const startCol = startLine === sel.startLine ? sel.startCol : sel.endCol;
    const endCol = endLine === sel.endLine ? sel.endCol : sel.startCol;
    if (index < startLine || index > endLine) return null;
    const text = renderedRows[index];
    const length = typeof text === 'string' ? text.length : 0;
    if (startLine === endLine) return { from: Math.min(startCol, endCol), to: Math.max(startCol, endCol) };
    if (index === startLine) return { from: startCol, to: length };
    if (index === endLine) return { from: 0, to: endCol };
    return { from: 0, to: length };
  }

  return (
    <Box flexDirection="column" justifyContent="flex-end" height={height}>
      {showPosition && (
        <Text dimColor>
          ↑ {linesAbove} line{linesAbove === 1 ? '' : 's'} above · newest ↓{linesBelow > 0 ? ` (+${linesBelow} below)` : ''}
        </Text>
      )}
      {visible.map((line, index) => {
        const renderedIndex = index + (showPosition ? 1 : 0);
        const range = rowRange(renderedIndex);
        return (
          <RowText
            key={index}
            line={line}
            from={range ? range.from : null}
            to={range ? range.to : null}
          />
        );
      })}
    </Box>
  );
}