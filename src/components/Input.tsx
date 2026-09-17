import React, { useEffect, useRef, useState } from 'react';
import { Text, useCursor, useInput, useStdout } from 'ink';
import { runTurn } from '../agent/loop.js';
import { answerApproval } from '../agent/permissions.js';
import { useSession } from '../state/session.js';
import { BLOCK_CURSOR, inputFrameRow } from '../ink/cursor.js';
import { isMouseSequence, handleMouseInput } from '../ink/mouse.js';
import { inputView, dropLastChar } from './input-layout.js';

export function Input({ scrollPage = 10, width = 76 }: { scrollPage?: number; width?: number }) {
  const [value, setValue] = useState('');
  // The text lives in a ref as well as state: the keystroke handler reads and
  // writes the ref, so two keys arriving before React re-renders never build on
  // a stale value.
  const valueRef = useRef('');
  const s = useSession();
  const { stdout } = useStdout();
  const { setCursorPosition } = useCursor();
  const view = inputView(valueRef.current, width);
  const showingText = !s.approvalPending && s.transcriptScrollUp === 0;

  // The block cursor sits at the text insertion point: two columns in (the
  // border's │ and its padding space) plus the visible text's width, measured
  // with stringWidth so wide characters count. y is the input row, third from
  // the bottom (info bar, bottom border, input); inputFrameRow carries the +1
  // Ink's fullscreen frames need. Set during render, as Ink documents: useCursor
  // hands the position to Ink in its own useInsertionEffect, which runs before
  // this commit's frame is written - a useLayoutEffect call runs after that and
  // only lands a frame late (measured: the cursor stayed hidden when the window
  // opened). Hidden while the row shows a hint instead of the text.
  setCursorPosition(
    showingText ? { x: 2 + view.width, y: inputFrameRow(stdout.rows ?? 24) } : undefined
  );

  // The terminal's real cursor becomes a steady block for the whole session; it is
  // restored to the shell's default shape by the AlternateScreen exit paths.
  useEffect(() => {
    try {
      process.stdout.write(BLOCK_CURSOR);
    } catch {
      // A closed stream must never crash the app.
    }
  }, []);

  useInput((input, key) => {
    // SGR mouse events arrive as CSI chunks Ink cannot resolve; the wheel
    // scrolls the transcript and every other mouse event is consumed here so
    // none of it ever lands in the text.
    if (isMouseSequence(input)) {
      handleMouseInput(input);
      return;
    }
    if (s.pickerOpen || s.keysOpen || s.wizardActive || s.helpOpen) return;
    if (s.approvalPending) {
      const answer = input.toLowerCase();
      if (answer === 'y') answerApproval(true);
      else if (answer === 'n') answerApproval(false);
      return;
    }
    if (key.ctrl && input === 'm') {
      s.openPicker();
      return;
    }
    if (key.ctrl && input === 'r') {
      s.toggleShowLastReasoning();
      return;
    }
    // The alternate screen has no native scrollback, so these keys scroll the
    // transcript region itself (Claude Code's bindings): arrows move 3 rows,
    // Page Up/Down a full page, End jumps back to the newest and re-follows.
    if (key.upArrow) {
      s.scrollTranscript(3);
      return;
    }
    if (key.downArrow) {
      s.scrollTranscript(-3);
      return;
    }
    if (key.pageUp) {
      s.scrollTranscript(scrollPage);
      return;
    }
    if (key.pageDown) {
      s.scrollTranscript(-scrollPage);
      return;
    }
    if (key.end) {
      s.followTranscript();
      return;
    }
    // Anything typed while reading history returns to the newest first.
    if (key.return) {
      const text = valueRef.current.trim();
      // /exit is honoured even mid-turn so a wedged request can never trap the user.
      if (text === '/exit' || (text && s.status !== 'working')) {
        s.followTranscript();
        valueRef.current = '';
        setValue('');
        void runTurn(text);
      }
      return;
    }
    if (key.backspace || key.delete) {
      s.followTranscript();
      valueRef.current = dropLastChar(valueRef.current);
      setValue(valueRef.current);
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    s.followTranscript();
    valueRef.current += input;
    setValue(valueRef.current);
  });

  if (s.approvalPending) {
    return <Text color="yellow">y = allow · n = deny</Text>;
  }

  // While the transcript is scrolled away from the newest, the prompt is replaced
  // by Claude Code's reading-history hint; End (or any typing) returns to the live
  // conversation.
  if (s.transcriptScrollUp > 0) {
    return <Text dimColor>reading history — press End to return</Text>;
  }

  // Trailing spaces are dimmed: invisible on screen, but it makes the frame's
  // bytes differ from the same text without them, keeping Ink on its full-frame
  // path (see input-layout.ts).
  return (
    <Text>
      {value ? (
        <Text>
          {view.text}
          {view.trailingSpaces ? <Text dimColor>{view.trailingSpaces}</Text> : null}
        </Text>
      ) : (
        <Text dimColor>ask anything</Text>
      )}
    </Text>
  );
}
