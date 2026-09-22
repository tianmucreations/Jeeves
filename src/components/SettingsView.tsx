import React, { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import { session } from '../state/session.js';
import { runTurn } from '../agent/loop.js';
import { SETTINGS_ROWS, SETTINGS_ITEMS } from '../commands/settings.js';

// Everything in one place, grouped and scrollable, instead of having to remember
// the separate slash commands - the owner asked for this directly. Choosing an
// item runs the exact command it names (the same thing typing it would do), so
// nothing here duplicates any screen's own logic; the screen it opens simply
// takes over next, the ordinary way.
export function SettingsView({ rows }: { rows: number }) {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (key.escape) {
      session.closeSettings();
      return;
    }
    if (key.upArrow) {
      setSelected((current) => Math.max(0, current - 1));
      return;
    }
    if (key.downArrow) {
      setSelected((current) => Math.min(SETTINGS_ITEMS.length - 1, current + 1));
      return;
    }
    if (key.return) {
      const item = SETTINGS_ITEMS[selected];
      session.closeSettings();
      void runTurn(item.command);
    }
  });

  let itemIndex = -1;
  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>Settings - everything in one place</Text>
      <Box flexDirection="column" flexGrow={1} justifyContent="center">
        {SETTINGS_ROWS.map((row, key) => {
          if (row.kind === 'header') {
            return (
              <Text key={key} dimColor>
                {row.title}
              </Text>
            );
          }
          itemIndex += 1;
          const isSelected = itemIndex === selected;
          return (
            <Text key={key} color={isSelected ? 'cyan' : undefined} inverse={isSelected}>
              {'  ' + row.label + (row.hint ? ' - ' + row.hint : '')}
            </Text>
          );
        })}
      </Box>
      <Text dimColor>↑↓ move · Enter choose · Esc close</Text>
    </Box>
  );
}
