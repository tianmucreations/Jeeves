import React, { useEffect, useRef } from 'react';
import { Box, Text, useCursor, useInput, usePaste, useStdout } from 'ink';
import { runTurn } from '../agent/loop.js';
import { answerApproval, currentApprovalTrustable } from '../agent/permissions.js';
import { session, useSession } from '../state/session.js';
import { BLOCK_CURSOR, inputFrameRow } from '../ink/cursor.js';
import { isMouseSequence, handleMouseInput } from '../ink/mouse.js';
import { inputLayout, dropLastChar, splitTypedBurst, cleanPaste } from './input-layout.js';

// The rows the input box needs for the text being typed (the window makes room).
export const MAX_INPUT_ROWS = 6;
export function inputRowsFor(text: string, width: number): number {
  return text ? inputLayout(text, width, MAX_INPUT_ROWS).rows.length : 1;
}

// Sends a message, then any sent while Jeeves was busy, one after another.
async function sendAndDrain(text: string): Promise<void> {
  await runTurn(text);
  for (let next = session.takeQueued(); next !== undefined; next = session.takeQueued()) {
    await runTurn(next);
  }
}

export function Input({ scrollPage = 10, width = 76 }: { scrollPage?: number; width?: number }) {
  // The text lives in a ref as well as state: the keystroke handler reads and
  // writes the ref, so two keys arriving before React re-renders never build on
  // a stale value.
  const valueRef = useRef(session.inputText);
  const s = useSession();
  const { stdout } = useStdout();
  const { setCursorPosition } = useCursor();
  const layout = inputLayout(valueRef.current, width, MAX_INPUT_ROWS);
  const showingText = !s.approvalPending && s.transcriptScrollUp === 0;
  const setValue = (text: string) => {
    valueRef.current = text;
    session.setInputText(text);
  };

  // The block cursor sits at the text insertion point: two columns in (the
  // border's │ and its padding space) plus the visible text's width, measured
  // with stringWidth so wide characters count. y is the input row, third from
  // the bottom (info bar, bottom border, input); inputFrameRow carries the +1
  // Ink's fullscreen frames need. Set during render, as Ink documents: useCursor
  // hands the position to Ink in its own useInsertionEffect, which runs before
  // this commit's frame is written - a useLayoutEffect call runs after that and
  // only lands a frame late (measured: the cursor stayed hidden when the window
  // opened). Hidden while the row shows a hint instead of the text.
  // The last row of the box stays on the same terminal row however tall the box
  // grows (it grows upwards), so the cursor's row is unchanged.
  setCursorPosition(
    showingText ? { x: 2 + layout.cursorX, y: inputFrameRow(stdout.rows ?? 24) } : undefined
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
      else if (answer === 'a' && currentApprovalTrustable()) answerApproval(true, true);
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
    // A burst of typing that ends with Enter is typing plus Enter (see splitTypedBurst).
    const burst = key.return ? { typed: '', enter: true, rest: '' } : splitTypedBurst(input);
    if (burst.enter) {
      const text = (valueRef.current + burst.typed).trim();
      setValue(burst.rest);
      if (!text) return;
      s.followTranscript();
      // /exit is honoured even mid-turn so a wedged request can never trap the user.
      if (text === '/exit' || s.status !== 'working') {
        void sendAndDrain(text);
      } else {
        // Busy: the message waits its turn and is sent as soon as this job finishes.
        session.queueMessage(text);
        session.addNotice(`Noted - I'll read this as soon as I've finished: "${text.length > 80 ? text.slice(0, 79) + '…' : text}"`);
      }
      return;
    }
    if (key.backspace || key.delete) {
      s.followTranscript();
      setValue(dropLastChar(valueRef.current));
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    s.followTranscript();
    setValue(valueRef.current + input);
  });

  // Pasted text arrives whole (bracketed paste), keeps its line breaks, and never
  // sends by itself - only Enter does.
  usePaste((text) => {
    if (s.pickerOpen || s.keysOpen || s.wizardActive || s.helpOpen || s.approvalPending) return;
    s.followTranscript();
    setValue(valueRef.current + cleanPaste(text));
  });

  if (s.approvalPending) {
    return (
      <Text color="yellow">{currentApprovalTrustable() ? 'y = allow · a = always allow in this project · n = deny' : 'y = allow · n = deny'}</Text>
    );
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
  if (!valueRef.current) {
    return <Text dimColor>{s.status === 'working' ? 'type your next message - it will be sent when I finish' : 'ask anything'}</Text>;
  }
  return (
    <Box flexDirection="column">
      {layout.rows.map((row, index) => (
        <Text key={index}>
          {row.text}
          {row.trailingSpaces ? <Text dimColor>{row.trailingSpaces}</Text> : null}
        </Text>
      ))}
    </Box>
  );
}
