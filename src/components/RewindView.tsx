import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from '../vendor/ink/index.js';
import { session } from '../state/session.js';
import { rewindPoints, rewindTo, type RewindPoint } from '../checkpoints/index.js';
import { ago } from '../platform/conversations.js';
import { isMouseSequence, parseMouseSequence, subscribeMouse } from '../ink/mouse.js';

// "Go back to an earlier point": each point is a message in which Jeeves changed something, newest
// first (Claude Code's /rewind lists earlier messages; OpenCode reverts to one). Choose one and click
// "Go back" twice - the folder is put back to how it was before that message.
const BUTTON = ' Go back ';

export function RewindView({ rows }: { rows: number }) {
  const [points, setPoints] = useState<RewindPoint[] | null>(null);
  const [selected, setSelected] = useState(0);
  const [asked, setAsked] = useState<string | null>(null);
  useEffect(() => {
    void rewindPoints().then(setPoints, () => setPoints([]));
  }, []);
  const list = points ?? [];
  const height = Math.max(1, rows - 4);
  const at = Math.min(selected, Math.max(0, list.length - 1));
  const first = Math.max(0, Math.min(at - Math.floor(height / 2), list.length - height));

  const goBack = () => {
    const point = list[at];
    if (!point) return;
    if (session.busy()) {
      session.addNotice('Going back works between tasks - try again when I have finished.');
      session.closeRewind();
      return;
    }
    if (asked !== point.id) {
      setAsked(point.id);
      return;
    }
    session.closeRewind();
    void rewindTo(point.id).then((outcome) => {
      session.addNotice(outcome.message);
      if (outcome.historyNote) session.pendingContextNote = outcome.historyNote;
    });
  };

  const onMouse = (report: string) => {
    const event = parseMouseSequence(report);
    if (!event) return;
    if (event.kind === 'wheel') return setSelected((c) => Math.max(0, Math.min(list.length - 1, c + (event.button === 0 ? -1 : 1))));
    if (event.kind !== 'press' || event.button !== 0) return;
    if (event.row === rows) {
      if (event.col >= 2 && event.col <= BUTTON.length + 1) goBack();
      return;
    }
    const index = first + event.row - 2;
    if (list[index]) {
      setSelected(index);
      setAsked(null);
    }
  };
  const onMouseRef = useRef(onMouse);
  onMouseRef.current = onMouse;
  useEffect(() => subscribeMouse((report) => onMouseRef.current(report)), []);

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
    if (key.escape) return session.closeRewind();
    if (key.upArrow) return setSelected(Math.max(0, at - 1)), setAsked(null);
    if (key.downArrow) return setSelected(Math.min(list.length - 1, at + 1)), setAsked(null);
    if (key.return) return goBack();
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor bold>GO BACK TO AN EARLIER POINT</Text>
      <Box flexDirection="column" flexGrow={1}>
        {points === null ? <Text dimColor>{' Looking…'}</Text> : null}
        {points !== null && list.length === 0 ? <Text dimColor>{' Nothing to go back to yet - a point is kept each time I change something in this folder.'}</Text> : null}
        {list.slice(first, first + height).map((point, offset) => {
          const label = point.label.length > 60 ? point.label.slice(0, 59) + '…' : point.label;
          return (
            <Text key={point.id} inverse={first + offset === at} wrap="truncate-end">
              {` Before "${label}"`}
              <Text dimColor={first + offset !== at}>{`  ${asked === point.id ? '- click Go back again to confirm' : ago(point.createdAt)}`}</Text>
            </Text>
          );
        })}
      </Box>
      <Text wrap="truncate-end">
        <Text inverse>{BUTTON}</Text>
        <Text dimColor>  ↑↓ or click to choose · puts the folder back to how it was · Esc back</Text>
      </Text>
    </Box>
  );
}
