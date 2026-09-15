import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import Fuse from 'fuse.js';
import { useSession } from '../state/session.js';
import { isToolCapable } from '../models/filter.js';
import { type ModelInfo, compactContext, compactPrice, isFastModel } from '../models/registry.js';
import { setFavorites, setRecents } from '../platform/config.js';
import { summariseHistory } from '../agent/context.js';
import { hasCredentials } from '../providers/index.js';
import { listLocalOllamaModels, isOllamaOnline } from '../providers/ollama.js';

const TABS = ['favorites', 'recent', 'all', 'tools'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  favorites: 'Favorites',
  recent: 'Recent',
  all: 'All',
  tools: 'Tool-capable',
};

// The calm first step: providers in spec order. Direct connections unlock with the key vault (Phase 7).
const PROVIDER_ROWS = [
  { id: 'openrouter', label: 'OpenRouter', description: 'one key unlocks 400+ models - recommended' },
  { id: 'anthropic', label: 'Anthropic', description: 'direct connection' },
  { id: 'openai', label: 'OpenAI', description: 'direct connection' },
  { id: 'google', label: 'Google', description: 'direct connection' },
  { id: 'xai', label: 'xAI', description: 'direct connection' },
  { id: 'groq', label: 'Groq', description: 'direct connection' },
  { id: 'mistral', label: 'Mistral', description: 'direct connection' },
  { id: 'ollama', label: 'Ollama', description: 'local models, no key needed' },
];

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

type Item =
  | { kind: 'header'; label: string }
  | { kind: 'back' }
  | { kind: 'model'; model: ModelInfo };
type Phase = 'browse' | 'switch-confirm' | 'tool-warning';
type Step = 'providers' | 'models';

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

// The cursor skips group headers; both the back row and model rows are selectable.
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

export function ModelPicker({ rows, columns }: { rows: number; columns: number }) {
  const s = useSession();
  const [step, setStep] = useState<Step>('providers');
  const [providerCursor, setProviderCursor] = useState(0);
  const [providerChoice, setProviderChoice] = useState<'openrouter' | 'ollama'>('openrouter');
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [ollamaModels, setOllamaModels] = useState<ModelInfo[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [phase, setPhase] = useState<Phase>('browse');
  const [pending, setPending] = useState<ModelInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    void isOllamaOnline().then((online) => {
      if (!cancelled) setOllamaOnline(online);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalog = providerChoice === 'ollama' ? (ollamaModels ?? []) : s.models;
  const listHeight = Math.max(1, rows - 5);

  const items = useMemo<Item[]>(() => {
    if (step !== 'models') return [];
    const pool = poolFor(tab, catalog, s.favorites, s.recents);
    const matched = fuzzyMatch(pool, query);
    const flat: Item[] = [{ kind: 'back' }];
    if (providerChoice === 'ollama') {
      flat.push({ kind: 'header', label: 'Ollama (local)' });
      for (const model of matched) flat.push({ kind: 'model', model });
    } else {
      const groups = groupModels(matched);
      for (const provider of orderedProviders(groups)) {
        flat.push({ kind: 'header', label: providerLabel(provider) });
        for (const model of groups.get(provider) ?? []) {
          flat.push({ kind: 'model', model });
        }
      }
    }
    return flat;
  }, [step, tab, query, catalog, s.favorites, s.recents, providerChoice]);

  const counts = useMemo(
    () => ({
      favorites: poolFor('favorites', catalog, s.favorites, s.recents).length,
      recent: poolFor('recent', catalog, s.favorites, s.recents).length,
      all: catalog.length,
      tools: catalog.filter(isToolCapable).length,
    }),
    [catalog, s.favorites, s.recents]
  );

  const resolved = resolveIndex(items, cursor);
  const half = Math.floor(listHeight / 2);
  const start = Math.max(0, Math.min(items.length - listHeight, resolved - half));
  const visible = items.slice(start, start + listHeight);
  const highlighted = resolved >= 0 && items[resolved]?.kind === 'model' ? (items[resolved] as { model: ModelInfo }).model : null;

  function providerEnabled(rowId: string): boolean {
    if (rowId === 'openrouter') return hasCredentials();
    if (rowId === 'ollama') return ollamaOnline === true;
    return false;
  }

  function providerHint(rowId: string): string {
    if (rowId === 'ollama') {
      return ollamaOnline === null ? 'checking…' : 'not running - start the Ollama app';
    }
    return 'add key';
  }

  function chooseProvider(): void {
    const row = PROVIDER_ROWS[providerCursor];
    if (!row) return;
    if (row.id === 'openrouter') {
      if (!hasCredentials()) return;
      setProviderChoice('openrouter');
      setStep('models');
      setCursor(0);
    } else if (row.id === 'ollama') {
      if (ollamaOnline !== true) return;
      setProviderChoice('ollama');
      setStep('models');
      setCursor(0);
      void listLocalOllamaModels()
        .then(setOllamaModels)
        .catch(() => setOllamaModels([]));
    }
  }

  function backToProviders(): void {
    setQuery('');
    setCursor(0);
    setStep('providers');
  }

  function applyModel(model: ModelInfo): void {
    s.setProvider(providerChoice === 'ollama' ? 'ollama' : 'openrouter');
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
    if (resolved < 0) return;
    const current = items[resolved];
    if (!current || current.kind === 'header') return;
    if (current.kind === 'back') {
      backToProviders();
      return;
    }
    const model = current.model;
    if (model.id === s.model && providerChoice === (s.providerId as 'openrouter' | 'ollama')) {
      s.closePicker();
      return;
    }
    if (!isToolCapable(model)) {
      setPending(model);
      setPhase('tool-warning');
      return;
    }
    if (s.history.length > 0) {
      setPending(model);
      setPhase('switch-confirm');
      return;
    }
    applyModel(model);
    s.addNotice(`Switched to ${model.name}.`);
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
    if (step === 'providers') {
      if (key.escape) {
        s.closePicker();
        return;
      }
      if (key.upArrow) {
        setProviderCursor((current) => Math.max(0, current - 1));
        return;
      }
      if (key.downArrow) {
        setProviderCursor((current) => Math.min(PROVIDER_ROWS.length - 1, current + 1));
        return;
      }
      if (key.return) {
        chooseProvider();
        return;
      }
      return;
    }
    if (key.escape) {
      backToProviders();
      return;
    }
    if (key.tab) {
      const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length];
      setTab(next);
      setCursor(0);
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

  if (step === 'providers') {
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor>Choose an AI provider</Text>
        <Box flexDirection="column" flexGrow={1}>
          {PROVIDER_ROWS.map((row, index) => {
            const enabled = providerEnabled(row.id);
            const selected = index === providerCursor;
            return (
              <Text key={row.id} inverse={selected} dimColor={!enabled && !selected}>
                {column(' ' + row.label, 16)}
                {enabled ? <Text dimColor>{row.description}</Text> : <Text>{providerHint(row.id)}</Text>}
              </Text>
            );
          })}
        </Box>
        <Text dimColor>↑↓ move · Enter choose · Esc close</Text>
      </Box>
    );
  }

  const emptyMessage =
    providerChoice === 'ollama'
      ? ollamaModels === null
        ? 'Loading local models…'
        : ollamaModels.length === 0
          ? 'Could not reach Ollama - is the app still running?'
          : ''
      : s.models.length === 0 && s.modelsNote
        ? s.modelsNote
        : s.models.length === 0
          ? 'Loading the model list…'
          : items.length <= 1
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
        : `Tab list · ↑↓ move · type to search · + favorite · Enter select · Esc back`;

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>{providerLabel(providerChoice)} — pick a model</Text>
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
        {emptyMessage ? (
          <Text dimColor>
            <Spinner type="dots" /> {emptyMessage}
          </Text>
        ) : (
          visible.map((item, index) => {
            const absoluteIndex = start + index;
            if (item.kind === 'header') {
              return (
                <Text key={`h${absoluteIndex}`} dimColor>
                  {`── ${item.label} ──`}
                </Text>
              );
            }
            if (item.kind === 'back') {
              const selected = absoluteIndex === resolved;
              return (
                <Text key="back" inverse={selected} dimColor={!selected}>
                  ← Back to providers
                </Text>
              );
            }
            const selected = absoluteIndex === resolved;
            return (
              <Text key={`m${item.model.id}`} inverse={selected} wrap="truncate-end">
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