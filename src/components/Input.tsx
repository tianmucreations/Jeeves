import React, { useEffect, useState } from 'react';
import { Text, useCursor, useInput, useStdout } from 'ink';
import { runTurn } from '../agent/loop.js';
import { answerApproval } from '../agent/permissions.js';
import { useSession } from '../state/session.js';
import { BLOCK_CURSOR, inputFrameRow } from '../ink/cursor.js';
import { isMouseSequence, handleMouseInput } from '../ink/mouse.js';

export function Input({ scrollPage = 10 }: { scrollPage?: number }) {
  const [value, setValue] = useState('');
  const s = useSession();
  const { stdout } = useStdout();
  const { setCursorPosition } = useCursor();

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
    // Mouse reporting bytes never reach the typing layer: selection drags, releases,
    // and wheel scrolls are consumed by the copy-on-select machinery.
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
    if (key.tab) {
      s.tabFooter();
      return;
    }
    if (key.escape) {
      s.escapeFooter();
      return;
    }
    if (key.return) {
      const text = value.trim();
      if (text && s.status !== 'working') {
        setValue('');
        s.followTranscript();
        void runTurn(text);
      }
      return;
    }
    // The terminal's own scrollback is off (alternate screen), so the arrow and
    // page keys scroll the transcript region instead, three lines per press.
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
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    setValue((v) => v + input);
  });

  // The block cursor sits exactly at the text insertion point, tracking typing and
  // screen changes. Coordinates are relative to the Ink frame origin (the alternate
  // screen's home). The content column is 2 in 0-based frame terms: border, padding,
  // then text.
  setCursorPosition({ x: 2 + value.length, y: inputFrameRow(stdout.rows ?? 24) });

  if (s.approvalPending) {
    return <Text color="yellow">y = allow · n = deny</Text>;
  }

  return (
    <Text>
      {value ? <Text>{value}</Text> : <Text dimColor>ask anything</Text>}
    </Text>
  );
}