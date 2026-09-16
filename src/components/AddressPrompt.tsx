import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { session } from '../state/session.js';
import { getAddress, setAddress } from '../platform/config.js';

// The first-launch question, in Jeeves' own voice, asked once before the project
// picker whenever no address is saved; /address reopens the same screen later.
export function AddressPrompt({ rows }: { rows: number }) {
  const [value, setValue] = useState('');
  const firstRun = session.launchStage === 'address';

  useInput((input, key) => {
    if (key.return) {
      const address = value.trim() || getAddress() || 'Sir';
      setAddress(address.slice(0, 30));
      session.addressDone();
      session.addNotice(`Very good - I shall address you as ${address.slice(0, 30)}.`);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    setValue((v) => (v.length >= 30 ? v : v + input));
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>Good evening. Before we begin — how shall I address you? Sir, Madam, or something else?</Text>
      <Box flexGrow={1} justifyContent="center" flexDirection="column" minHeight={1}>
        <Text>
          <Text dimColor>Address: </Text>
          <Text>{value}</Text>
          <Text inverse> </Text>
        </Text>
      </Box>
      {firstRun ? <Text dimColor>type your title · Enter save</Text> : <Text dimColor>type a new title · Enter save · unchanged keeps the current one</Text>}
    </Box>
  );
}
