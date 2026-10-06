import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { session } from '../state/session.js';
import { getAddress, setAddress } from '../platform/config.js';
import { ButtonRow, buttonAt } from './ButtonRow.js';
import { isMouseSequence, parseMouseSequence, subscribeMouse } from '../ink/mouse.js';
import { cleanAddress, timeOfDayGreeting, ADDRESS_MAX } from '../platform/address.js';
import { splitTypedBurst } from './input-layout.js';

// The first-launch question, in Jeeves' own voice, asked once before the project
// picker whenever no address is saved; /address reopens the same screen later.
// Two buttons on the third row: click one, or type something else below.
const SIR = ' Sir ';
const MAAM = " Ma'am ";
const BUTTON_ROW = 3;
// Save sits under the name field: title, blank, Sir/Ma'am, blank, the field, blank, Save.
const SAVE_ROW = 7;

export function AddressPrompt({ rows }: { rows: number }) {
  const [value, setValue] = useState('');
  const [note, setNote] = useState('');
  const firstRun = session.launchStage === 'address';

  const submit = (typedValue: string) => {
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
  };
  const save = { label: 'Save', run: () => submit(value.slice(0, ADDRESS_MAX)) };
  // Back (Esc): closes the screen without changing anything. On the very first
  // launch there is nothing to go back to, so it carries on without an address.
  const back = { label: firstRun ? 'Skip' : '← Back', run: () => session.addressDone() };
  const buttons = [save, back];
  const choose = (title: string) => {
    setAddress(title);
    session.addressDone();
    session.addNotice(`Very good - I shall address you as ${title}.`);
  };
  const onMouse = (report: string) => {
    const event = parseMouseSequence(report);
    if (!event || event.kind !== 'press' || event.button !== 0) return;
    if (event.row === SAVE_ROW) return void buttonAt(buttons, event.col)?.run();
    if (event.row !== BUTTON_ROW) return;
    if (event.col >= 1 && event.col <= SIR.length) choose('Sir');
    else if (event.col >= SIR.length + 3 && event.col < SIR.length + 3 + MAAM.length) choose("Ma'am");
  };
  const onMouseRef = useRef(onMouse);
  onMouseRef.current = onMouse;
  useEffect(() => subscribeMouse((report) => onMouseRef.current(report)), []);

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
    if (key.escape) {
      back.run();
      return;
    }
    // Typing and Enter can arrive together (as in the main typing box, 18 Sept):
    // the text before the line break is typed text, the break is Enter.
    const burst = key.return ? { typed: '', enter: true } : splitTypedBurst(input);
    if (burst.enter) {
      submit((value + burst.typed).slice(0, ADDRESS_MAX));
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
      <Text> </Text>
      <Text>
        <Text color="yellow" inverse>{SIR}</Text>
        {'  '}
        <Text color="yellow" inverse>{MAAM}</Text>
      </Text>
      <Text> </Text>
      <Text>
        <Text>Or type another name: </Text>
        <Text underline>{value}</Text>
        <Text inverse> </Text>
      </Text>
      <Text> </Text>
      <ButtonRow buttons={buttons} />
      {note ? <Text color="yellow">{note}</Text> : null}
    </Box>
  );
}
