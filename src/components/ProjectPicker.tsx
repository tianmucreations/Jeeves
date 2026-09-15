import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Fuse from 'fuse.js';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { session, useSession } from '../state/session.js';
import { setRecentProjects } from '../platform/config.js';
import { homeLocations, listSubfolders, displayPath, type FolderEntry } from '../platform/paths.js';
import { hasCredentials } from '../providers/index.js';

type Item =
  | { kind: 'header'; label: string }
  | { kind: 'recent'; folder: string }
  | { kind: 'browse' }
  | { kind: 'back' }
  | { kind: 'choose' }
  | { kind: 'folder'; entry: FolderEntry };

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

export function ProjectPicker({ rows }: { rows: number; columns: number }) {
  const s = useSession();
  const [mode, setMode] = useState<'list' | 'browse'>('list');
  const [stack, setStack] = useState<string[]>([]);
  const [filter, setFilter] = useState('');
  const [cursor, setCursor] = useState(0);

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
      const out: Item[] = [];
      if (recents.length > 0) {
        out.push({ kind: 'header', label: 'Recent projects' });
        for (const folder of recents) out.push({ kind: 'recent', folder });
      } else {
        out.push({ kind: 'header', label: 'No recent projects yet - pick Browse below' });
      }
      out.push({ kind: 'browse' });
      return out;
    }
    const out: Item[] = [];
    if (current !== null) {
      out.push({ kind: 'back' }, { kind: 'choose' });
      for (const entry of fuzzyFolders(listing.folders, filter)) out.push({ kind: 'folder', entry });
    } else {
      for (const entry of fuzzyFolders(homeLocations(), filter)) out.push({ kind: 'folder', entry });
    }
    return out;
  }, [mode, current, listing, filter, s.recentProjects]);

  const resolved = resolveIndex(items, cursor);
  const half = Math.floor(listHeight / 2);
  const start = Math.max(0, Math.min(items.length - listHeight, resolved - half));
  const visible = items.slice(start, start + listHeight);

  function startProject(folder: string): void {
    try {
      process.chdir(folder);
    } catch {
      // Staying in the current folder is the safe fallback.
    }
    const updated = [folder, ...session.recentProjects.filter((p) => p !== folder)].slice(0, 10);
    session.setRecentProjects(updated);
    setRecentProjects(updated);
    session.launchComplete();
    session.addNotice(`Now working in ${displayPath(folder)}.`);
    if (!hasCredentials()) {
      session.startWizard(true);
    } else {
      session.openPicker();
    }
  }

  function goBack(): void {
    setFilter('');
    setCursor(0);
    if (stack.length > 1) {
      setStack(stack.slice(0, -1));
      return;
    }
    if (stack.length === 1) {
      setStack([]);
      return;
    }
    setMode('list');
  }

  function openFolder(folder: string): void {
    setFilter('');
    setCursor(0);
    setStack([...stack, folder]);
  }

  useInput((input, key) => {
    if (mode === 'list') {
      if (key.escape) {
        startProject(process.cwd());
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
      if (key.return) {
        const item = items[resolved];
        if (!item) return;
        if (item.kind === 'recent') startProject(item.folder);
        if (item.kind === 'browse') {
          setMode('browse');
          setStack([]);
          setFilter('');
          setCursor(0);
        }
        return;
      }
      return;
    }
    if (key.escape) {
      goBack();
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
    if (key.return) {
      const item = items[resolved];
      if (!item) return;
      if (item.kind === 'back') goBack();
      if (item.kind === 'choose' && current !== null) startProject(current);
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
  });

  const title =
    mode === 'list'
      ? 'Choose a project'
      : current !== null
        ? `Open a folder - now in ${displayPath(current)}`
        : 'Open a folder - where do you keep your projects?';

  const hint =
    mode === 'list'
      ? '↑↓ move · Enter choose · Esc current folder'
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
              <Text key={`r${item.folder}`} inverse={selected}>
                {` ${name}`.padEnd(26)}
                <Text dimColor>{displayPath(item.folder)}</Text>
              </Text>
            );
          }
          if (item.kind === 'browse') {
            return (
              <Text key="browse" inverse={selected}>
                {' Browse for a folder →'}
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
      <Text dimColor>{hint}</Text>
    </Box>
  );
}