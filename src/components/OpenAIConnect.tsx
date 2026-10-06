import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { isMouseSequence } from '../ink/mouse.js';

// OpenAI has two ways in, and - as OpenCode does (dialog-provider.tsx "Select auth method") -
// the person is asked once they have picked OpenAI: the ChatGPT plan they may already pay for,
// or an API key. Used by Manage keys, the first-run setup and the model list alike.
const CHOICES = [
  { title: 'Sign in with ChatGPT (Plus or Pro plan)', detail: 'Uses the plan you already pay for. Your browser opens; log in and click to allow. No key to copy.' },
  { title: 'Paste an OpenAI API key', detail: 'For people who made a key at platform.openai.com. You pay OpenAI for each use.' },
];

export function OpenAIConnect({ onPlan, onKey, onBack }: { onPlan: () => void; onKey: () => void; onBack: () => void }) {
  const [cursor, setCursor] = useState(0);

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
    if (key.escape) return onBack();
    if (key.upArrow || key.downArrow) return setCursor((current) => (current === 0 ? 1 : 0));
    if (input === '1' || input === '2') {
      setCursor(Number(input) - 1);
      return input === '1' ? onPlan() : onKey();
    }
    if (key.return) return cursor === 0 ? onPlan() : onKey();
  });

  return (
    <Box flexDirection="column">
      <Text>How do you want to connect to OpenAI?</Text>
      <Text> </Text>
      {CHOICES.map((choice, index) => (
        <Box key={choice.title} flexDirection="column">
          <Text inverse={index === cursor}>{` ${index + 1}. ${choice.title} `}</Text>
          <Text dimColor wrap="wrap">{`    ${choice.detail}`}</Text>
        </Box>
      ))}
      <Text> </Text>
      <Text dimColor>↑↓ or 1 / 2 choose · Enter continue · Esc back</Text>
    </Box>
  );
}
