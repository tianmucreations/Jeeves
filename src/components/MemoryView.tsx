import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from '../vendor/ink/index.js';
import { session } from '../state/session.js';
import { allNotes, removeNote } from '../platform/memory.js';
import { isMouseSequence, parseMouseSequence, subscribeMouse } from '../ink/mouse.js';

// "What I remember": the notes Jeeves keeps about you and this folder, each with a Delete button, so
// nothing is remembered that the person cannot see and remove.
const DELETE_BUTTON = ' Delete ';

export function MemoryView({ rows }: { rows: number }) {
  const [notes, setNotes] = useState(() => allNotes());
  const [selected, setSelected] = useState(0);
  const [asked, setAsked] = useState<string | null>(null);
  const height = Math.max(1, rows - 4);
  const at = Math.min(selected, Math.max(0, notes.length - 1));
  const first = Math.max(0, Math.min(at - Math.floor(height / 2), notes.length - height));

  const removeSelected = () => {
    const note = notes[at];
    if (!note) return;
    if (asked === note.id) {
      removeNote(note.id);
      setNotes(allNotes());
      setAsked(null);
    } else {
      setAsked(note.id);
    }
  };

  const onMouse = (report: string) => {
    const event = parseMouseSequence(report);
    if (!event) return;
    if (event.kind === 'wheel') return setSelected((c) => Math.max(0, Math.min(notes.length - 1, c + (event.button === 0 ? -1 : 1))));
    if (event.kind !== 'press' || event.button !== 0) return;
    if (event.row === rows) {
      if (event.col >= 2 && event.col <= DELETE_BUTTON.length + 1) removeSelected();
      return;
    }
    const index = first + event.row - 2;
    if (notes[index]) {
      setSelected(index);
      setAsked(null);
    }
  };
  const onMouseRef = useRef(onMouse);
  onMouseRef.current = onMouse;
  useEffect(() => subscribeMouse((report) => onMouseRef.current(report)), []);

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
    if (key.escape) return session.closeMemory();
    if (key.upArrow) return setSelected(Math.max(0, at - 1)), setAsked(null);
    if (key.downArrow) return setSelected(Math.min(notes.length - 1, at + 1)), setAsked(null);
    if (key.delete || key.backspace) return removeSelected();
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor bold>WHAT I REMEMBER</Text>
      <Box flexDirection="column" flexGrow={1}>
        {notes.length === 0 ? <Text dimColor>{' Nothing yet. Tell me "remember that ..." and I will keep it for next time.'}</Text> : null}
        {notes.slice(first, first + height).map((note, offset) => (
          <Text key={note.id} inverse={first + offset === at} wrap="truncate-end">
            {` ${note.text}`}
            <Text dimColor={first + offset !== at}>{`  (${note.about === 'me' ? 'about you' : 'this folder'})${asked === note.id ? ' - click Delete again to remove it' : ''}`}</Text>
          </Text>
        ))}
      </Box>
      <Text wrap="truncate-end">
        <Text inverse>{DELETE_BUTTON}</Text>
        <Text dimColor>  ↑↓ or click a note to choose it · Esc back</Text>
      </Text>
    </Box>
  );
}
