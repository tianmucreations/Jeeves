import React, { useEffect, useState } from 'react';
import { Text, useCursor, useInput, useStdout } from 'ink';
import { runTurn } from '../agent/loop.js';
import { answerApproval } from '../agent/permissions.js';
import { useSession } from '../state/session.js';
import { BLOCK_CURSOR, inputFrameRow } from '../ink/cursor.js';

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
      const text = value.trim();
      // /exit is honoured even mid-turn so a wedged request can never trap the user.
      if (text === '/exit' || (text && s.status !== 'working')) {
        s.followTranscript();
        setValue('');
        void runTurn(text);
      }
      return;
    }
    if (key.backspace || key.delete) {
      s.followTranscript();
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    s.followTranscript();
    setValue((v) => v + input);
  });

  // The block cursor sits exactly at the text insertion point, tracking typing and
  // screen changes. Coordinates are relative to the Ink frame origin (the alternate
  // screen's home); the input row is rows-2 in 0-based frame terms and the text is
  // flush at column 0.
  setCursorPosition({ x: value.length, y: inputFrameRow(stdout.rows ?? 24) });

  if (s.approvalPending) {
    return <Text color="yellow">y = allow · n = deny</Text>;
  }

  // While the transcript is scrolled away from the newest, the prompt is replaced
  // by Claude Code's reading-history hint; End (or any typing) returns to the live
  // conversation.
  if (s.transcriptScrollUp > 0) {
    return <Text dimColor>reading history — press End to return</Text>;
  }

  return (
    <Text>
      {value ? <Text>{value}</Text> : <Text dimColor>ask anything</Text>}
    </Text>
  );
}