import React, { useState } from 'react';
import { Text, useInput } from 'ink';
import { runTurn } from '../agent/loop.js';
import { useSession } from '../state/session.js';

export function Input() {
  const [value, setValue] = useState('');
  const s = useSession();

  useInput((input, key) => {
    if (key.return) {
      const text = value.trim();
      if (text && s.status !== 'working') {
        setValue('');
        void runTurn(text);
      }
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    setValue((v) => v + input);
  });

  return (
    <Text>
      <Text bold>{'> '}</Text>
      {value ? <Text>{value}</Text> : <Text dimColor>ask anything</Text>}
    </Text>
  );
}