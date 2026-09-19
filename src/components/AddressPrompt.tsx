import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { session } from '../state/session.js';
import { getAddress, setAddress } from '../platform/config.js';
import { isMouseSequence } from '../ink/mouse.js';
import { cleanAddress, timeOfDayGreeting, ADDRESS_MAX } from '../platform/address.js';
import { splitTypedBurst } from './input-layout.js';

// The first-launch question, in Jeeves' own voice, asked once before the project
// picker whenever no address is saved; /address reopens the same screen later.
export function AddressPrompt({ rows }: { rows: number }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const firstRun = session.launchStage === 'address';

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
    // Typing and Enter can arrive together (as in the main typing box, 18 Sept):
    // the text before the line break is typed text, the break is Enter.
    const burst = key.return ? { typed: '', enter: true } : splitTypedBurst(input);
    if (burst.enter) {
      const typedValue = (value + burst.typed).slice(0, ADDRESS_MAX);
      // Nothing typed keeps the current address; on the first run there is none to
      // keep, so Jeeves asks rather than guessing "Sir".
      const address = cleanAddress(typedValue) ?? getAddress();
      if (!address) {
        setValue(typedValue);
        setNote("Type Sir, Ma'am, your name, or whatever you'd like to be called.");
        return;
      }
      setAddress(address);
      session.addressDone();
      session.addNotice(`Very good - I shall address you as ${address}.`);
      return;
    }
    if (key.backspace || key.delete) {
      setValue((v) => v.slice(0, -1));
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    setNote('');
    setValue((v) => (v.length >= ADDRESS_MAX ? v : v + input));
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>{timeOfDayGreeting()}. Before we begin — how shall I address you? Sir, Ma'am, or something else?</Text>
      <Box flexGrow={1} justifyContent="center" flexDirection="column" minHeight={1}>
        <Text>
          <Text dimColor>Address: </Text>
          <Text>{value}</Text>
          <Text inverse> </Text>
        </Text>
      </Box>
      {note ? <Text color="yellow">{note}</Text> : null}
      {firstRun ? <Text dimColor>type Sir, Ma'am or a name · Enter save</Text> : <Text dimColor>type a new title · Enter save · unchanged keeps the current one</Text>}
    </Box>
  );
}
