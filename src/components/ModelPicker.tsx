import React, { useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import Fuse from 'fuse.js';
import { useSession } from '../state/session.js';
import { isToolCapable } from '../models/filter.js';
import { type ModelInfo, compactContext, compactPrice, isFastModel } from '../models/registry.js';
import { setFavorites, setRecents } from '../platform/config.js';
import { summariseHistory } from '../agent/context.js';
import { hasCredentials } from '../providers/index.js';

const TABS = ['favorites', 'recent', 'all', 'tools'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  favorites: 'Favorites',
  recent: 'Recent',
  all: 'All',
  tools: 'Tool-capable',
};

// Provider groups in the order the spec defines, then everything else alphabetically.
const PROVIDER_ORDER = ['openrouter', 'anthropic', 'openai', 'google', 'x-ai', 'groq', 'mistral', 'ollama'];
const PROVIDER_LABELS: Record<string, string> = {
  openrouter: 'OpenRouter',
  anthropic: 'Anthropic',
  openai: 'OpenAI',
  google: 'Google',
  'x-ai': 'xAI',
  groq: 'Groq',
  mistral: 'Mistral',
  ollama: 'Ollama',
};

type Item = { kind: 'header'; label: string } | { kind: 'model'; model: ModelInfo };
type Phase = 'browse' | 'switch-confirm' | 'tool-warning';

function providerLabel(provider: string): string {
  return PROVIDER_LABELS[provider] ?? provider;
}

function groupModels(models: ModelInfo[]): Map<string, ModelInfo[]> {
  const groups = new Map<string, ModelInfo[]>();
  for (const model of models) {
    const list = groups.get(model.provider);
    if (list) {
      list.push(model);
    } else {
      groups.set(model.provider, [model]);
    }
  }
  return groups;
}

function orderedProviders(groups: Map<string, ModelInfo[]>): string[] {
  const rest = [...groups.keys()].filter((provider) => !PROVIDER_ORDER.includes(provider)).sort();
  return [...PROVIDER_ORDER.filter((provider) => groups.has(provider)), ...rest];
}

function column(text: string, width: number): string {
  return text.length >= width ? text.slice(0, width - 1) + '…' : text.padEnd(width);
}

function rowText(model: ModelInfo): string {
  return (
    column(model.name, 30) +
    column(model.provider, 11) +
    column(compactContext(model.contextLength), 7) +
    column(compactPrice(model.promptPrice, model.completionPrice), 20) +
    (isToolCapable(model) ? '✓' : '✗') +
    (isFastModel(model) ? ' »' : '')
  );
}

function poolFor(tab: Tab, models: ModelInfo[], favorites: string[], recents: string[]): ModelInfo[] {
  const byId = new Map(models.map((model) => [model.id, model]));
  if (tab === 'favorites') return favorites.map((id) => byId.get(id)).filter((m): m is ModelInfo => m !== undefined);
  if (tab === 'recent') return recents.map((id) => byId.get(id)).filter((m): m is ModelInfo => m !== undefined);
  if (tab === 'tools') return models.filter(isToolCapable);
  return models;
}

function fuzzyMatch(pool: ModelInfo[], query: string): ModelInfo[] {
  if (!query) return pool;
  const fuse = new Fuse(pool, { keys: ['name', 'id'], threshold: 0.4, ignoreLocation: true });
  return fuse.search(query).map((result) => result.item);
}

function resolveModelIndex(items: Item[], cursor: number): number {
  const start = cursor < 0 ? 0 : cursor;
  for (let i = start; i < items.length; i++) {
    if (items[i].kind === 'model') return i;
  }
  for (let i = Math.min(start, items.length - 1); i >= 0; i--) {
    if (items[i].kind === 'model') return i;
  }
  return -1;
}

function stepModel(items: Item[], from: number, delta: number): number {
  let i = from;
  do {
    i += delta;
  } while (i >= 0 && i < items.length && items[i].kind !== 'model');
  return i >= 0 && i < items.length ? i : from;
}

export function ModelPicker({ rows, columns }: { rows: number; columns: number }) {
  const s = useSession();
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [phase, setPhase] = useState<Phase>('browse');
  const [pending, setPending] = useState<ModelInfo | null>(null);

  const greyed = !hasCredentials();
  const listHeight = Math.max(1, rows - 5);

  const items = useMemo<Item[]>(() => {
    const pool = poolFor(tab, s.models, s.favorites, s.recents);
    const matched = fuzzyMatch(pool, query);
    const groups = groupModels(matched);
    const flat: Item[] = [];
    for (const provider of orderedProviders(groups)) {
      flat.push({ kind: 'header', label: providerLabel(provider) });
      for (const model of groups.get(provider) ?? []) {
        flat.push({ kind: 'model', model });
      }
    }
    return flat;
  }, [tab, query, s.models, s.favorites, s.recents]);

  const counts = useMemo(() => ({
    favorites: poolFor('favorites', s.models, s.favorites, s.recents).length,
    recent: poolFor('recent', s.models, s.favorites, s.recents).length,
    all: s.models.length,
    tools: s.models.filter(isToolCapable).length,
  }), [s.models, s.favorites, s.recents]);

  const resolved = resolveModelIndex(items, cursor);
  const half = Math.floor(listHeight / 2);
  const start = Math.max(0, Math.min(items.length - listHeight, resolved - half));
  const visible = items.slice(start, start + listHeight);
  const highlighted = resolved >= 0 && items[resolved]?.kind === 'model' ? (items[resolved] as { model: ModelInfo }).model : null;

  function applyModel(model: ModelInfo): void {
    s.setModel(model.id);
    const updatedRecents = [model.id, ...s.recents.filter((id) => id !== model.id)].slice(0, 10);
    s.setRecents(updatedRecents);
    setRecents(updatedRecents);
  }

  function toggleFavorite(): void {
    if (!highlighted) return;
    const updated = s.favorites.includes(highlighted.id)
      ? s.favorites.filter((id) => id !== highlighted.id)
      : [...s.favorites, highlighted.id];
    s.setFavorites(updated);
    setFavorites(updated);
  }

  function selectHighlighted(): void {
    if (!highlighted) return;
    if (highlighted.id === s.model) {
      s.closePicker();
      return;
    }
    if (!isToolCapable(highlighted)) {
      setPending(highlighted);
      setPhase('tool-warning');
      return;
    }
    if (s.history.length > 0) {
      setPending(highlighted);
      setPhase('switch-confirm');
      return;
    }
    applyModel(highlighted);
    s.addNotice(`Switched to ${highlighted.name}.`);
    s.closePicker();
  }

  useInput((input, key) => {
    if (phase === 'tool-warning') {
      if (key.return) {
        if (pending) {
          applyModel(pending);
          s.addNotice('Chat-only mode - this model cannot call tools.');
        }
        s.closePicker();
      } else if (key.escape) {
        setPhase('browse');
      }
      return;
    }
    if (phase === 'switch-confirm') {
      if (input === 'k') {
        if (pending) {
          applyModel(pending);
          s.addNotice(`Switched to ${pending.name} - conversation kept.`);
        }
        s.closePicker();
      } else if (input === 's') {
        if (pending) {
          applyModel(pending);
          s.addNotice(`Switched to ${pending.name} - summarising the conversation.`);
        }
        s.closePicker();
        void summariseHistory();
      } else if (input === 'f') {
        if (pending) {
          applyModel(pending);
          s.addNotice(`Switched to ${pending.name} - starting fresh.`);
        }
        s.setHistory([]);
        s.closePicker();
      } else if (key.escape) {
        setPhase('browse');
      }
      return;
    }
    if (key.escape) {
      s.closePicker();
      return;
    }
    if (key.tab) {
      const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length];
      setTab(next);
      setCursor(0);
      return;
    }
    if (key.upArrow) {
      setCursor(stepModel(items, resolved, -1));
      return;
    }
    if (key.downArrow) {
      setCursor(stepModel(items, resolved, 1));
      return;
    }
    if (key.return) {
      selectHighlighted();
      return;
    }
    if (key.backspace || key.delete) {
      setQuery((current) => current.slice(0, -1));
      setCursor(0);
      return;
    }
    if (input === '+') {
      toggleFavorite();
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    setQuery((current) => current + input);
    setCursor(0);
  });

  const emptyMessage =
    s.models.length === 0 && s.modelsNote
      ? `${s.modelsNote}`
      : s.models.length === 0
        ? 'Loading the model list…'
        : items.length === 0
          ? query
            ? `No models match "${query}".`
            : tab === 'favorites'
              ? 'No favorites yet - highlight a model and press +'
              : tab === 'recent'
                ? 'No recently used models yet.'
                : 'No models.'
          : '';

  const hint =
    phase === 'tool-warning'
      ? `This model can't call tools, so reading files and running commands won't work.  Enter: continue in chat-only mode · Esc: pick another`
      : phase === 'switch-confirm'
        ? `Keep this conversation (k) · Summarise it first (s) · Start fresh (f) · Esc: cancel`
        : `Tab list · ↑↓ move · type to search · + favorite · Enter select · Esc close`;

  return (
    <Box flexDirection="column" height={rows}>
      <Box>
        {TABS.map((name) => (
          <React.Fragment key={name}>
            <Text inverse={name === tab} dimColor={name !== tab}>
              {' '}
              {TAB_LABELS[name]} ({counts[name]}){' '}
            </Text>
            <Text> </Text>
          </React.Fragment>
        ))}
      </Box>
      <Box>
        <Text dimColor>search: </Text>
        <Text>{query}</Text>
        <Text dimColor>{query ? '' : 'type to filter'}</Text>
      </Box>
      <Text dimColor>context in tokens · prices per million tokens · ✓ tools · » fast</Text>
      <Box flexDirection="column" height={listHeight}>
        {s.models.length === 0 ? (
          <Text dimColor>
            <Spinner type="dots" /> {emptyMessage}
          </Text>
        ) : emptyMessage ? (
          <Text dimColor>{emptyMessage}</Text>
        ) : (
          visible.map((item, index) => {
            const absoluteIndex = start + index;
            if (item.kind === 'header') {
              return (
                <Text key={`h${absoluteIndex}`} dimColor>
                  {`── ${item.label} ──${greyed ? '  (add key)' : ''}`}
                </Text>
              );
            }
            const selected = absoluteIndex === resolved;
            return (
              <Text key={`m${item.model.id}`} inverse={selected} dimColor={greyed && !selected} wrap="truncate-end">
                {rowText(item.model)}
              </Text>
            );
          })
        )}
      </Box>
      <Box justifyContent="space-between">
        <Text dimColor>{hint}</Text>
        <Text dimColor>{s.modelsNote}</Text>
      </Box>
    </Box>
  );
}