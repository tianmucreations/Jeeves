import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Fuse from 'fuse.js';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { session, useSession } from '../state/session.js';
import { setRecentProjects, getAddress } from '../platform/config.js';
import { homeLocations, listSubfolders, displayPath, projectNameProblem, type FolderEntry } from '../platform/paths.js';
import { hasCredentials, keysRead } from '../providers/index.js';
import { isMouseSequence } from '../ink/mouse.js';
import { ensureChatFolder, chatNotice } from '../platform/chat-folder.js';

type Item =
  | { kind: 'header'; label: string }
  | { kind: 'chat' }
  | { kind: 'recent'; folder: string }
  | { kind: 'browse' }
  | { kind: 'create' }
  | { kind: 'back' }
  | { kind: 'choose' }
  | { kind: 'create-here' }
  | { kind: 'location'; entry: FolderEntry }
  | { kind: 'folder'; entry: FolderEntry };

type Mode = 'list' | 'browse' | 'create-name' | 'create-location' | 'create-confirm';

// The cursor skips header lines; every other row is selectable.
function resolveIndex(items: Item[], cursor: number): number {
  const start = cursor < 0 ? 0 : cursor;
  for (let i = start; i < items.length; i++) {
    if (items[i].kind !== 'header') return i;
  }
  for (let i = Math.min(start, items.length - 1); i >= 0; i--) {
    if (items[i].kind !== 'header') return i;
  }
  return -1;
}

function stepItem(items: Item[], from: number, delta: number): number {
  let i = from;
  do {
    i += delta;
  } while (i >= 0 && i < items.length && items[i].kind === 'header');
  return i >= 0 && i < items.length ? i : from;
}

function fuzzyFolders(pool: FolderEntry[], query: string): FolderEntry[] {
  if (!query) return pool;
  const fuse = new Fuse(pool, { keys: ['name'], threshold: 0.4 });
  return fuse.search(query).map((result) => result.item);
}

export function ProjectPicker({ rows, columns }: { rows: number; columns: number }) {
  const s = useSession();
  const [mode, setMode] = useState<Mode>('list');
  const [purpose, setPurpose] = useState<'open' | 'create'>('open');
  const [stack, setStack] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState(0);
  const [createName, setCreateName] = useState('');
  const [createTarget, setCreateTarget] = useState<FolderEntry | null>(null);
  const [note, setNote] = useState('');

  const listHeight = Math.max(1, rows - 4);
  const current = stack.length > 0 ? stack[stack.length - 1] : null;

  // Reading a folder is synchronous and fast, so both the listing and the menu are pure calculations.
  const listing = useMemo(() => {
    if (mode !== 'browse' || current === null) return { folders: [] as FolderEntry[], error: '' };
    return listSubfolders(current);
  }, [mode, current]);

  const items = useMemo<Item[]>(() => {
    if (mode === 'list') {
      const recents = s.recentProjects.filter((folder) => existsSync(folder));
      // First, for anyone who only wants to ask something: no project needed.
      const out: Item[] = [{ kind: 'chat' }];
      if (recents.length > 0) {
        out.push({ kind: 'header', label: 'Recent projects' });
        for (const folder of recents) out.push({ kind: 'recent', folder });
      } else {
        out.push({ kind: 'header', label: 'No recent projects yet - pick Browse below' });
      }
      out.push({ kind: 'browse' }, { kind: 'create' });
      return out;
    }
    if (mode === 'browse') {
      const out: Item[] = [];
      if (current !== null) {
        out.push({ kind: 'back' });
        out.push(purpose === 'create' ? { kind: 'create-here' } : { kind: 'choose' });
        for (const entry of fuzzyFolders(listing.folders, filter)) out.push({ kind: 'folder', entry });
      } else {
        for (const entry of fuzzyFolders(homeLocations(), filter)) out.push({ kind: 'folder', entry });
      }
      return out;
    }
    if (mode === 'create-location') {
      const out: Item[] = [];
      for (const entry of homeLocations()) out.push({ kind: 'location', entry });
      out.push({ kind: 'browse' });
      return out;
    }
    return [];
  }, [mode, purpose, current, listing, filter, s.recentProjects]);

  const resolved = resolveIndex(items, cursor);
  const half = Math.floor(listHeight / 2);
  const start = Math.max(0, Math.min(items.length - listHeight, resolved - half));
  const visible = items.slice(start, start + listHeight);

  function startChat(): void {
    const folder = ensureChatFolder();
    if (!folder) {
      setNote("The Jeeves Chats folder couldn't be made in Documents - pick a project instead.");
      return;
    }
    startProject(folder, false);
  }

  function startProject(folder: string, remember = true): void {
    try {
      process.chdir(folder);
    } catch {
      // Staying in the current folder is the safe fallback.
    }
    // The chat folder is not a project, so it never joins the recent list.
    if (remember) {
      const updated = [folder, ...session.recentProjects.filter((p) => p !== folder)].slice(0, 10);
      session.setRecentProjects(updated);
      setRecentProjects(updated);
    }
    session.launchComplete();
    session.addNotice(remember ? `Now working in ${displayPath(folder)}.` : chatNotice(getAddress() ?? 'Sir'));
    // Only once the saved keys have been read can "no key yet" be true.
    void keysRead().then(() => {
      if (!hasCredentials()) {
        session.startWizard(true);
      } else {
        session.openPicker();
      }
    });
  }

  async function createProject(folder: string): Promise<void> {
    try {
      await mkdir(folder, { recursive: true });
      startProject(folder);
    } catch {
      setNote('That location could not be written to - pick another.');
      setMode('create-location');
    }
  }

  function goBack(): void {
    setFilter('');
    setCursor(0);
    setNote('');
    if (stack.length > 1) {
      setStack(stack.slice(0, -1));
      return;
    }
    if (stack.length === 1) {
      setStack([]);
      return;
    }
    if (mode === 'browse' && purpose === 'create') {
      setMode('create-location');
      setPurpose('open');
      return;
    }
    setMode('list');
  }

  function openFolder(folder: string): void {
    setFilter('');
    setCursor(0);
    setStack([...stack, folder]);
  }

  function startCreate(): void {
    setCreateName('');
    setNote('');
    setCursor(0);
    setMode('create-name');
  }

  function clip(text: string): string {
    const width = Math.max(10, columns - 2);
    return text.length > width ? text.slice(0, width - 1) + '…' : text;
  }

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
        if (mode === 'create-name') {
      if (key.escape) {
        setMode('list');
        setNote('');
        return;
      }
      if (key.return) {
        const problem = projectNameProblem(createName);
        if (problem) {
          setNote(problem);
          return;
        }
        setNote('');
        setCursor(0);
        setMode('create-location');
        return;
      }
      if (key.backspace || key.delete) {
        setCreateName((name) => name.slice(0, -1));
        return;
      }
      if (!input || key.ctrl || key.meta) return;
      setCreateName((name) => (name.length >= 60 ? name : name + input));
      return;
    }
    if (mode === 'create-confirm') {
      if (key.return && createTarget !== null) {
        void createProject(path.join(createTarget.path, createName.trim()));
        return;
      }
      if (key.escape) {
        setMode('create-location');
        setCursor(0);
      }
      return;
    }
    if (key.upArrow) {
      setCursor(stepItem(items, resolved, -1));
      return;
    }
    if (key.downArrow) {
      setCursor(stepItem(items, resolved, 1));
      return;
    }
    if (key.escape) {
      if (mode === 'list') {
        startProject(process.cwd());
        return;
      }
      if (mode === 'create-location') {
        setMode('create-name');
        setCursor(0);
        return;
      }
      goBack();
      return;
    }
    if (mode === 'create-location' && key.return) {
      const item = items[resolved];
      if (!item) return;
      if (item.kind === 'location') {
        setCreateTarget(item.entry);
        setMode('create-confirm');
      }
      if (item.kind === 'browse') {
        setPurpose('create');
        setMode('browse');
        setStack([]);
        setFilter('');
        setCursor(0);
      }
      return;
    }
    if (mode === 'list' && key.return) {
      const item = items[resolved];
      if (!item) return;
      if (item.kind === 'chat') startChat();
      if (item.kind === 'recent') startProject(item.folder);
      if (item.kind === 'browse') {
        setPurpose('open');
        setMode('browse');
        setStack([]);
        setFilter('');
        setCursor(0);
      }
      if (item.kind === 'create') startCreate();
      return;
    }
    if (mode === 'browse') {
      if (key.return) {
        const item = items[resolved];
        if (!item) return;
        if (item.kind === 'back') goBack();
        if (item.kind === 'choose' && current !== null) startProject(current);
        if (item.kind === 'create-here' && current !== null) {
          void createProject(path.join(current, createName.trim()));
        }
        if (item.kind === 'folder') openFolder(item.entry.path);
        return;
      }
      if (key.backspace || key.delete) {
        setFilter((currentFilter) => currentFilter.slice(0, -1));
        setCursor(0);
        return;
      }
      if (!input || key.ctrl || key.meta) return;
      setFilter((currentFilter) => currentFilter + input);
      setCursor(0);
      return;
    }
  });

  const title =
    mode === 'list'
      ? 'Just chat, or choose a project'
      : mode === 'create-name'
        ? 'Create a new project'
        : mode === 'create-location'
          ? `Where should "${createName.trim()}" live?`
          : mode === 'create-confirm'
            ? 'Create the project?'
            : purpose === 'create'
              ? `Where should "${createName.trim()}" live? - now in ${current !== null ? displayPath(current) : 'your standard folders'}`
              : current !== null
                ? `Open a folder - now in ${displayPath(current)}`
                : 'Open a folder - where do you keep your projects?';

  const hint =
    mode === 'list'
      ? '↑↓ move · Enter choose · Esc current folder'
      : mode === 'create-name'
        ? 'type a name · Enter continue · Esc cancel'
        : mode === 'create-location'
          ? '↑↓ move · Enter choose · Esc back'
          : mode === 'create-confirm'
            ? 'Enter create · Esc back'
            : '↑↓ move · Enter open · type to filter · Esc back';

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>{title}</Text>
      {mode === 'browse' ? (
        <Box>
          <Text dimColor>filter: </Text>
          <Text>{filter}</Text>
          <Text dimColor>{filter ? '' : 'optional'}</Text>
        </Box>
      ) : null}
      <Box flexDirection="column" flexGrow={1} justifyContent="center" minHeight={listHeight}>
        {mode === 'create-name' ? (
          <Text>
            <Text dimColor>Name: </Text>
            <Text>{createName}</Text>
            <Text inverse> </Text>
          </Text>
        ) : null}
        {mode === 'create-confirm' && createTarget !== null ? (
          <Box flexDirection="column">
            <Text>{clip(`Create ${createName.trim()} in ${createTarget.name} →`)}</Text>
            <Text dimColor>{displayPath(createTarget.path)}</Text>
          </Box>
        ) : null}
        {visible.map((item, index) => {
          const absoluteIndex = start + index;
          const selected = absoluteIndex === resolved;
          if (item.kind === 'header') {
            return (
              <Text key={`h${absoluteIndex}`} dimColor>
                {item.label}
              </Text>
            );
          }
          if (item.kind === 'recent') {
            const name = path.basename(item.folder);
            return (
              <Text key={`r${item.folder}`} inverse={selected} wrap="truncate-middle">
                {` ${name}`.padEnd(26)}
                <Text dimColor>{displayPath(item.folder)}</Text>
              </Text>
            );
          }
          if (item.kind === 'chat') {
            return (
              <Text key="chat" inverse={selected}>
                <Text color="#c9a96a" bold>{' Just chat'}</Text>
                <Text dimColor>{' - no project needed'}</Text>
              </Text>
            );
          }
          if (item.kind === 'browse') {
            return (
              <Text key={`b${absoluteIndex}`} inverse={selected}>
                {' Browse for a folder →'}
              </Text>
            );
          }
          if (item.kind === 'create') {
            return (
              <Text key="create" inverse={selected}>
                {' Create a new project →'}
              </Text>
            );
          }
          if (item.kind === 'back') {
            return (
              <Text key="back" inverse={selected} dimColor={!selected}>
                {'← Back'}
              </Text>
            );
          }
          if (item.kind === 'choose') {
            return (
              <Text key="choose" inverse={selected}>
                {'✓ Choose this folder'}
              </Text>
            );
          }
          if (item.kind === 'create-here') {
            return current !== null ? (
              <Text key="create-here" inverse={selected}>
                {clip(`Create ${createName.trim()} in ${displayPath(current)} →`)}
              </Text>
            ) : null;
          }
          if (item.kind === 'location') {
            return (
              <Text key={`l${item.entry.path}`} inverse={selected}>
                {` ${item.entry.name}`}
              </Text>
            );
          }
          return (
            <Text key={`f${item.entry.path}`} inverse={selected}>
              {` ${item.entry.name}`}
            </Text>
          );
        })}
        {mode === 'browse' && current !== null && listing.folders.length === 0 && !listing.error ? (
          <Text dimColor>(no folders inside - this one may be your project)</Text>
        ) : null}
        {mode === 'browse' && listing.error ? <Text dimColor>({listing.error})</Text> : null}
      </Box>
      {note ? <Text color="yellow">{note}</Text> : <Text dimColor>{hint}</Text>}
    </Box>
  );
}