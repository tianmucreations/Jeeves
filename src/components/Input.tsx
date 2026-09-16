import React, { useState } from 'react';
import { Text, useInput } from 'ink';
import { runTurn } from '../agent/loop.js';
import { answerApproval } from '../agent/permissions.js';
import { useSession } from '../state/session.js';

export function Input({ scrollPage = 10 }: { scrollPage?: number }) {
  const [value, setValue] = useState('');
  const s = useSession();

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

  if (s.approvalPending) {
    return <Text color="yellow">y = allow · n = deny</Text>;
  }

  return (
    <Text>
      <Text bold>{'> '}</Text>
      {value ? <Text>{value}</Text> : <Text dimColor>ask anything</Text>}
    </Text>
  );
}