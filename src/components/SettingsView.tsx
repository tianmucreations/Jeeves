import React, { useState } from 'react';
import path from 'node:path';
import { Box, Text, useInput } from 'ink';
import { session, useSession } from '../state/session.js';
import { runTurn } from '../agent/loop.js';
import { settingsRows, selectableIndexes, type SettingsAction } from '../commands/settings.js';
import { enterFolder } from '../commands/folder.js';
import { applyModelChoice } from '../models/choose.js';
import { isFreeModel } from '../models/registry.js';
import { hasSavedDailyLimit, getDefaultModel } from '../platform/config.js';
import { chatFolder, ensureChatFolder } from '../platform/chat-folder.js';
import { displayPath } from '../platform/paths.js';
import { PROVIDER_ROWS, hasCredentialsFor } from '../providers/index.js';
import { isDirectService } from '../providers/direct-services.js';
import { ZAI_MODELS } from '../providers/zai.js';
import { isMouseSequence, parseMouseSequence } from '../ink/mouse.js';

// The folder, service and model are changed between tasks only, as their own screens are.
function busy(): boolean {
  if (session.status !== 'working' && !session.approvalPending) return false;
  session.addNotice('That can be changed between tasks - try again when I have finished.');
  return true;
}

export function runSettingsAction(action: SettingsAction): void {
  session.closeSettings();
  switch (action.type) {
    case 'command':
      void runTurn(action.command);
      return;
    case 'chat': {
      if (busy()) return;
      const folder = ensureChatFolder();
      if (!folder) {
        session.addNotice("The Jeeves Chats folder couldn't be made in Documents - pick a folder instead.");
        return;
      }
      if (folder === process.cwd()) return;
      session.switchingFolder = true;
      enterFolder(folder, false);
      return;
    }
    case 'folder':
      if (busy() || action.folder === process.cwd()) return;
      session.switchingFolder = true;
      enterFolder(action.folder);
      return;
    case 'browse':
    case 'create':
      session.folderPickerStart = action.type;
      session.openFolderPicker();
      return;
    case 'service':
      session.pickerStart = { provider: action.provider };
      session.openPicker();
      return;
    case 'all-models':
      session.pickerStart = { provider: action.provider, full: true };
      session.openPicker();
      return;
    case 'limit':
      session.pickerStart = { step: 'limit' };
      session.openPicker();
      return;
    case 'limit-weekly':
      session.pickerStart = { step: 'limit', weekly: true };
      session.openPicker();
      return;
    case 'model': {
      if (busy()) return;
      if (action.model.id === session.model && action.provider === session.providerId && getDefaultModel() !== null) return;
      applyModelChoice(action.provider, action.model.id);
      // The first model that costs money sets the daily limit, as the model list does.
      const paid = action.provider === 'openrouter' || isDirectService(action.provider);
      if (paid && !isFreeModel(action.model) && !hasSavedDailyLimit()) {
        session.pickerStart = { step: 'limit' };
        session.openPicker();
      }
      return;
    }
  }
}

// Everything in one place, every choice listed, scrolled with the arrows or the
// mouse wheel / trackpad, chosen with Enter or a click (owner, 23 Sept).
export function SettingsView({ rows }: { rows: number }) {
  const s = useSession();
  const serviceLabel = PROVIDER_ROWS.find((row) => row.id === s.providerId)?.label ?? s.providerName;
  const list = settingsRows({
    folder: process.cwd(),
    chatFolder: chatFolder(),
    recentProjects: s.recentProjects,
    providerId: s.providerId,
    providerLabel: serviceLabel,
    model: s.model,
    models: s.providerId === 'openrouter' ? s.models : s.providerId === 'zai' ? ZAI_MODELS : [],
    favorites: s.favorites,
    recents: s.recents,
    services: PROVIDER_ROWS,
    // Ollama needs no key, so "connected" would say nothing about whether it is running.
    connected: (id) => id !== 'ollama' && hasCredentialsFor(id),
    folderName: (folder) => path.basename(folder) || folder,
    folderPath: displayPath,
  });
  const selectable = selectableIndexes(list);
  // The highlight starts on whatever is in use in the first section (the current folder).
  const [selected, setSelected] = useState(() => {
    const current = list.findIndex((row) => row.kind === 'item' && row.current);
    return current >= 0 ? current : (selectable[0] ?? 0);
  });
  const [top, setTop] = useState(0);
  // Title row above, hint row below; the list fills the rest.
  const height = Math.max(1, rows - 2);
  const maxTop = Math.max(0, list.length - height);
  const clampTop = (value: number) => Math.max(0, Math.min(maxTop, value));
  // Keeps the highlighted row on screen, with its section title where there is room.
  const show = (index: number) => {
    setSelected(index);
    setTop((current) => {
      if (index < current + 1) return clampTop(index - 2);
      if (index >= current + height - 1) return clampTop(index - height + 2);
      return clampTop(current);
    });
  };
  const step = (delta: number) => {
    const at = selectable.indexOf(selected);
    const next = selectable[Math.max(0, Math.min(selectable.length - 1, at + delta))];
    if (next !== undefined) show(next);
  };
  const shownTop = clampTop(top);

  useInput((input, key) => {
    if (isMouseSequence(input)) {
      const event = parseMouseSequence(input);
      if (!event) return;
      if (event.kind === 'wheel') {
        setTop((current) => clampTop(current + (event.button === 0 ? -1 : 1)));
        return;
      }
      // A click on a row chooses it; the list starts on the screen's second row.
      if (event.kind === 'press' && event.button === 0) {
        const row = list[shownTop + event.row - 2];
        if (row?.kind === 'item') runSettingsAction(row.action);
      }
      return;
    }
    if (key.escape) {
      session.closeSettings();
      return;
    }
    if (key.upArrow) return step(-1);
    if (key.downArrow) return step(1);
    if (key.pageUp) return step(-Math.max(1, height - 2));
    if (key.pageDown) return step(Math.max(1, height - 2));
    if (key.return) {
      const row = list[selected];
      if (row?.kind === 'item') runSettingsAction(row.action);
    }
  });

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>Settings - everything in one place</Text>
      <Box flexDirection="column" height={height}>
        {list.slice(shownTop, shownTop + height).map((row, offset) => {
          const index = shownTop + offset;
          if (row.kind === 'gap') return <Text key={index}> </Text>;
          if (row.kind === 'header') {
            return (
              <Text key={index} dimColor bold wrap="truncate-end">
                {row.title}
              </Text>
            );
          }
          const isSelected = index === selected;
          return (
            <Text key={index} inverse={isSelected} wrap="truncate-end">
              {(row.current ? ' ✓ ' : '   ') + row.label}
              {row.hint ? <Text dimColor={!isSelected}>{' - ' + row.hint}</Text> : null}
            </Text>
          );
        })}
      </Box>
      <Text dimColor wrap="truncate-end">
        ↑↓ or scroll to move · Enter or click to choose · Esc close
      </Text>
    </Box>
  );
}
