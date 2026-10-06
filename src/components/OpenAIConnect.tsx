import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { ButtonRow, buttonAt } from './ButtonRow.js';
import { isMouseSequence, parseMouseSequence, subscribeMouse } from '../ink/mouse.js';

// OpenAI has two ways in, and - as OpenCode does (dialog-provider.tsx "Select auth method") - the person
// is asked once they have picked OpenAI: the ChatGPT plan they may already pay for, or an API key.
// Choose with the mouse or the keys. Each choice is three rows (its name, two lines of detail), from row 3.
const CHOICES = [
  { title: 'Sign in with ChatGPT (Plus or Pro plan)', detail: ['Uses the plan you already pay for. Your browser opens; log in and click to allow.', 'No key to copy.'] },
  { title: 'Paste an OpenAI API key', detail: ['For people who made a key at platform.openai.com.', 'You pay OpenAI for each use.'] },
];
const FIRST_ROW = 3;
// Choices fill rows 3-8, a blank row 9, then the Back button on row 10.
const BUTTON_ROW = 10;

export function OpenAIConnect({ onPlan, onKey, onBack }: { onPlan: () => void; onKey: () => void; onBack: () => void }) {
  const [cursor, setCursor] = useState(0);
  const BUTTONS = [{ label: '← Back', run: onBack }];
  const choose = (index: number) => (index === 0 ? onPlan() : onKey());

  const onMouse = (report: string) => {
    const event = parseMouseSequence(report);
    if (!event) return;
    if (event.kind === 'wheel') return setCursor((c) => (c === 0 ? 1 : 0));
    if (event.kind !== 'press' || event.button !== 0) return;
    if (event.row === BUTTON_ROW) return void buttonAt(BUTTONS, event.col)?.run();
    const index = Math.floor((event.row - FIRST_ROW) / 3);
    if (event.row >= FIRST_ROW && index >= 0 && index < CHOICES.length) choose(index);
  };
  const onMouseRef = useRef(onMouse);
  onMouseRef.current = onMouse;
  useEffect(() => subscribeMouse((report) => onMouseRef.current(report)), []);

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
    if (key.escape) return onBack();
    if (key.upArrow || key.downArrow) return setCursor((current) => (current === 0 ? 1 : 0));
    if (input === '1' || input === '2') return choose(Number(input) - 1);
    if (key.return) return choose(cursor);
  });

  return (
    <Box flexDirection="column">
      <Text>How do you want to connect to OpenAI?</Text>
      <Text> </Text>
      {CHOICES.map((choice, index) => (
        <Box key={choice.title} flexDirection="column">
          <Text inverse={index === cursor}>{` ${index + 1}. ${choice.title} `}</Text>
          {choice.detail.map((line) => (
            <Text key={line} dimColor wrap="truncate-end">{`    ${line}`}</Text>
          ))}
        </Box>
      ))}
      <Text> </Text>
      <Text>
        <ButtonRow buttons={BUTTONS} />
        <Text dimColor>  click one, or ↑↓ Enter</Text>
      </Text>
    </Box>
  );
}
