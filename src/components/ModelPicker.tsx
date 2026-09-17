import React, { useEffect, useMemo, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import Fuse from 'fuse.js';
import { session, useSession } from '../state/session.js';
import { isToolCapable } from '../models/filter.js';
import {
  type ModelInfo,
  compactContext,
  compactPrice,
  isFastModel,
  resolveCurated,
  cleanModelName,
} from '../models/registry.js';
import { setFavorites, setRecents, setDefaultModel, setDefaultProvider, setDailyLimit } from '../platform/config.js';
import { hasCredentials, hasCredentialsFor, storeZaiKey, PROVIDER_ROWS, storeOpenRouterKey, refreshCredit } from '../providers/index.js';
import { keyLooksValid } from '../commands/keys.js';
import { listLocalOllamaModels, isOllamaOnline } from '../providers/ollama.js';
import { ZAI_MODELS } from '../providers/zai.js';
import { isMouseSequence } from '../ink/mouse.js';

const TABS = ['favorites', 'recent', 'all', 'tools'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  favorites: 'Favorites',
  recent: 'Recent',
  all: 'All',
  tools: 'Tool-capable',
};

// The calm first step uses the shared provider list; keys live in the OS keychain (Phase 7).

const PROVIDER_ORDER = ['openrouter', 'zai', 'anthropic', 'openai', 'google', 'x-ai', 'groq', 'mistral', 'ollama'];
const PROVIDER_LABELS: Record<string, string> = {
  openrouter: 'OpenRouter',
  zai: 'Z.ai',
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
  | { kind: 'show-all' }
  | { kind: 'model'; model: ModelInfo; blurb?: string };
type Phase = 'browse' | 'tool-warning';
// Key entry happens inside the picker for Z.ai so a new user never leaves the flow.
// Simple thing first: providers, then a curated shortlist (big catalogs), then the full list on request.
type Step = 'providers' | 'curated' | 'full' | 'key' | 'limit';
// Which provider's catalog the picker is browsing.
type ProviderChoice = 'openrouter' | 'ollama' | 'zai';

// Model makers listed as services; they open their own models inside OpenRouter.
const COMPANY_PREFIX: Record<string, string> = {
  anthropic: 'anthropic',
  openai: 'openai',
  google: 'google',
  xai: 'x-ai',
  mistral: 'mistralai',
  groq: '',
};

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
    column(compactPrice(model.promptPrice, model.completionPrice, model.priceLabel), 20) +
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

// The cursor skips group headers; back, show-all, and model rows are all selectable.
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
  // The remembered provider starts highlighted so one Enter continues where you left off.
  const [providerCursor, setProviderCursor] = useState(() => {
    const remembered = PROVIDER_ROWS.findIndex((row) => row.id === session.providerId);
    return remembered >= 0 ? remembered : 0;
  });
  const [providerChoice, setProviderChoice] = useState<ProviderChoice>('openrouter');
  const [ollamaOnline, setOllamaOnline] = useState<boolean | null>(null);
  const [ollamaModels, setOllamaModels] = useState<ModelInfo[] | null>(null);
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [phase, setPhase] = useState<Phase>('browse');
  const [pending, setPending] = useState<ModelInfo | null>(null);
  const [keyValue, setKeyValue] = useState('');
  // Which service the key prompt is for, and which company's models to show after it.
  const [keyFor, setKeyFor] = useState<'openrouter' | 'zai'>('zai');
  const [jumpTo, setJumpTo] = useState<string | null>(null);
  const [limitValue, setLimitValue] = useState('');
  const [limitNote, setLimitNote] = useState('');
  const [keyNote, setKeyNote] = useState('');

  useEffect(() => {
    let cancelled = false;
    void isOllamaOnline().then((online) => {
      if (!cancelled) setOllamaOnline(online);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const catalog = providerChoice === 'ollama' ? (ollamaModels ?? []) : providerChoice === 'zai' ? ZAI_MODELS : s.models;
  const listHeight = Math.max(1, rows - 5);

  const items = useMemo<Item[]>(() => {
    if (step === 'curated') {
      const picks = resolveCurated(catalog);
      const flat: Item[] = [{ kind: 'back' }, { kind: 'header', label: 'Recommended' }];
      for (const pick of picks) {
        flat.push({ kind: 'model', model: pick.model, blurb: pick.blurb });
      }
      flat.push({ kind: 'header', label: '──────────' }, { kind: 'show-all' });
      return flat;
    }
    if (step === 'full') {
      const pool = poolFor(tab, catalog, s.favorites, s.recents);
      const matched = fuzzyMatch(pool, query);
      const flat: Item[] = [{ kind: 'back' }];
      if (providerChoice === 'ollama') {
        flat.push({ kind: 'header', label: 'Ollama (on this computer)' });
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
    }
    return [];
  }, [step, tab, query, catalog, s.favorites, s.recents, providerChoice]);

  const resolved = resolveIndex(items, cursor);
  const half = Math.floor(listHeight / 2);
  const start = Math.max(0, Math.min(items.length - listHeight, resolved - half));
  const visible = items.slice(start, start + listHeight);
  const highlighted = resolved >= 0 && items[resolved]?.kind === 'model' ? (items[resolved] as { model: ModelInfo }).model : null;

  // Every row does something when chosen: OpenRouter and Z.ai ask for their key
  // right here if it is missing; the model makers open their own models inside
  // OpenRouter (direct connections to them are not built).
  function providerEnabled(rowId: string): boolean {
    if (rowId === 'ollama') return ollamaOnline === true;
    return true;
  }

  function providerHint(rowId: string): string {
    if (rowId === 'ollama') {
      return ollamaOnline === null ? 'checking…' : 'not running - start the Ollama app';
    }
    return '';
  }

  function askForKey(service: 'openrouter' | 'zai'): void {
    setKeyFor(service);
    setKeyValue('');
    setKeyNote('');
    setStep('key');
  }

  function enterModelStep(forProvider: ProviderChoice): void {
    setProviderChoice(forProvider);
    setQuery('');
    setTab('all');
    // Big catalogs get the curated shortlist first; small ones go straight to the full list.
    const big = forProvider === 'openrouter' ? s.models.length > 8 : false;
    if (big) {
      // The remembered model starts highlighted so one Enter accepts it.
      const picks = resolveCurated(s.models);
      const remembered = picks.findIndex((pick) => pick.model.id === s.model);
      setCursor(remembered >= 0 ? 2 + remembered : 1);
    } else {
      setCursor(1);
    }
    setStep(big ? 'curated' : 'full');
  }

  function chooseProvider(): void {
    // The row under the services: the daily spending limit.
    if (providerCursor === PROVIDER_ROWS.length) {
      setLimitValue('');
      setLimitNote('');
      setStep('limit');
      return;
    }
    const row = PROVIDER_ROWS[providerCursor];
    if (!row) return;
    if (row.id === 'openrouter') {
      setJumpTo(null);
      if (!hasCredentialsFor('openrouter')) return askForKey('openrouter');
      enterModelStep('openrouter');
    } else if (row.id === 'zai') {
      if (!hasCredentialsFor('zai')) return askForKey('zai');
      enterModelStep('zai');
    } else if (row.id in COMPANY_PREFIX) {
      setJumpTo(COMPANY_PREFIX[row.id]);
      if (!hasCredentialsFor('openrouter')) return askForKey('openrouter');
      openCompanyModels();
    } else if (row.id === 'ollama') {
      if (ollamaOnline !== true) return;
      enterModelStep('ollama');
      void listLocalOllamaModels()
        .then(setOllamaModels)
        .catch(() => setOllamaModels([]));
    }
  }

  // A model maker's row opens the full OpenRouter list at that company's models.
  function openCompanyModels(): void {
    setProviderChoice('openrouter');
    setQuery('');
    setTab('all');
    setCursor(1);
    setStep('full');
  }

  useEffect(() => {
    if (step !== 'full' || jumpTo === null) return;
    const header = items.findIndex((item) => item.kind === 'header' && item.label === providerLabel(jumpTo));
    if (header >= 0) setCursor(header + 1);
    setJumpTo(null);
  }, [step, jumpTo, items]);

  function goBack(): void {
    if (step === 'key') {
      setKeyValue('');
      setKeyNote('');
      setStep('providers');
      return;
    }
    if (step === 'full' && providerChoice === 'openrouter') {
      setQuery('');
      setCursor(1);
      setStep('curated');
    } else if (step === 'curated' || step === 'full') {
      setStep('providers');
    }
  }

  function backLabel(): string {
    return step === 'full' && providerChoice === 'openrouter' ? '← Back to recommended' : '← Back to providers';
  }

  function applyModel(model: ModelInfo): void {
    const provider: ProviderChoice = providerChoice;
    s.setProvider(provider);
    s.setModel(model.id);
    setDefaultProvider(provider);
    setDefaultModel(model.id);
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
      goBack();
      return;
    }
    if (current.kind === 'show-all') {
      setStep('full');
      setQuery('');
      setTab('all');
      setCursor(1);
      return;
    }
    const model = current.model;
    if (model.id === s.model && providerChoice === (s.providerId as ProviderChoice)) {
      s.closePicker();
      return;
    }
    if (!isToolCapable(model)) {
      setPending(model);
      setPhase('tool-warning');
      return;
    }
    // A switch mid-conversation simply carries the conversation on (context
    // housekeeping keeps it lean; /clear starts afresh). No "Switched to" line:
    // the info bar already names the model.
    applyModel(model);
    s.closePicker();
  }

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
        if (phase === 'tool-warning') {
      if (key.return) {
        if (pending) {
          applyModel(pending);
        }
        s.closePicker();
      } else if (key.escape) {
        setPhase('browse');
      }
      return;
    }
    if (step === 'key') {
      if (key.escape) {
        goBack();
        return;
      }
      if (key.return) {
        const trimmed = keyValue.trim();
        if (!keyLooksValid(trimmed, keyFor)) {
          setKeyNote(
            keyFor === 'openrouter'
              ? 'Not an OpenRouter key (they start with sk-or-) - paste it again, or Esc'
              : 'That looks too short to be a key - paste it again, or Esc'
          );
          setKeyValue('');
          return;
        }
        const store = keyFor === 'openrouter' ? storeOpenRouterKey : storeZaiKey;
        void store(trimmed).then((saved) => {
          if (!saved) {
            setKeyNote('The Mac keychain was not reachable - press Enter and try again.');
            return;
          }
          if (keyFor === 'zai') {
            enterModelStep('zai');
          } else {
            void refreshCredit();
            if (s.status === 'disconnected') s.setStatus('idle');
            if (jumpTo !== null) openCompanyModels();
            else enterModelStep('openrouter');
          }
        });
        return;
      }
      if (key.backspace || key.delete) {
        setKeyValue((v) => v.slice(0, -1));
        return;
      }
      if (!input || key.ctrl || key.meta) return;
      setKeyNote('');
      setKeyValue((v) => v + input);
      return;
    }
    if (step === 'limit') {
      if (key.escape) {
        setStep('providers');
        return;
      }
      if (key.return) {
        const amount = Number(limitValue.replace(/^\$/, ''));
        if (!Number.isFinite(amount) || amount <= 0 || amount > 1000) {
          setLimitNote('Type an amount in dollars, like 3 or 7.50');
          setLimitValue('');
          return;
        }
        const rounded = Math.round(amount * 100) / 100;
        setDailyLimit(rounded);
        s.setDailyLimit(rounded);
        setStep('providers');
        return;
      }
      if (key.backspace || key.delete) {
        setLimitValue((v) => v.slice(0, -1));
        return;
      }
      if (/^[0-9.$]$/.test(input)) {
        setLimitNote('');
        setLimitValue((v) => (v + input).slice(0, 8));
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
        setProviderCursor((current) => Math.min(PROVIDER_ROWS.length, current + 1));
        return;
      }
      if (key.return) {
        chooseProvider();
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
      selectHighlighted();
      return;
    }
    if (key.tab && step === 'full') {
      const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length];
      setTab(next);
      setCursor(1);
      return;
    }
    if (key.backspace || key.delete) {
      if (step === 'full') setQuery((current) => current.slice(0, -1));
      setCursor(1);
      return;
    }
    if (input === '+') {
      toggleFavorite();
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    if (step === 'full') {
      setQuery((current) => current + input);
      setCursor(1);
    }
  });

  if (step === 'providers') {
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor>Choose an AI service</Text>
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
          <Text> </Text>
          <Text inverse={providerCursor === PROVIDER_ROWS.length}>
            {column(' Daily limit', 16)}
            <Text dimColor>${s.dailyLimit.toFixed(2)} a day - Enter to change</Text>
          </Text>
        </Box>
        <Text dimColor>↑↓ move · Enter choose · Esc close</Text>
      </Box>
    );
  }

  if (step === 'limit') {
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor>Daily spending limit</Text>
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <Text>
            <Text>Most to spend in a day, in dollars (now ${s.dailyLimit.toFixed(2)}): </Text>
            <Text>{limitValue}</Text>
            <Text inverse> </Text>
          </Text>
          <Text dimColor>When today's spending reaches it, Jeeves stops and asks before spending more.</Text>
        </Box>
        {limitNote ? <Text color="yellow">{limitNote}</Text> : <Text dimColor>type an amount · Enter save · Esc back</Text>}
      </Box>
    );
  }

  if (step === 'key') {
    const service = keyFor === 'openrouter' ? 'OpenRouter' : 'Z.ai';
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor>{keyFor === 'openrouter' ? 'OpenRouter — one key unlocks 400+ models' : 'Z.ai — GLM Coding Plan'}</Text>
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <Text>
            <Text>Paste your {service} API key (it stays hidden): </Text>
            <Text dimColor>{keyValue ? `${keyValue.length} characters ` : ''}</Text>
            <Text inverse> </Text>
          </Text>
          <Text dimColor>
            {keyFor === 'openrouter' ? 'Get one at openrouter.ai/settings/keys. ' : ''}It is stored in your Mac keychain and never shown again.
          </Text>
        </Box>
        {keyNote ? (
          <Text color="yellow">{keyNote}</Text>
        ) : (
          <Text dimColor>paste the key · Enter save · Esc back</Text>
        )}
      </Box>
    );
  }

  if (step === 'curated') {
    const picks = resolveCurated(catalog);
    const hint = `↑↓ move · + favorite · Enter select · Esc back`;
    return (
      <Box flexDirection="column" height={rows}>
        <Box flexGrow={1} flexDirection="column" justifyContent="center" minHeight={listHeight}>
          {s.models.length === 0 ? (
            <Text dimColor>
              <Spinner type="dots" /> Loading the model list…
            </Text>
          ) : (
            visible.map((item, index) => {
              const absoluteIndex = start + index;
              const selected = absoluteIndex === resolved;
              if (item.kind === 'header') {
                return (
                  <Text key={`h${absoluteIndex}`} dimColor>
                    {item.label ? `${item.label}` : ''}
                  </Text>
                );
              }
              if (item.kind === 'back') {
                return (
                  <Text key="back" inverse={selected} dimColor={!selected}>
                    {backLabel()}
                  </Text>
                );
              }
              if (item.kind === 'show-all') {
                return (
                  <Text key="showall" inverse={selected} dimColor={!selected}>
                    Show all {catalog.length} models →
                  </Text>
                );
              }
              const tools = isToolCapable(item.model) ? '✓' : '✗';
              return (
                <Text key={`m${item.model.id}`} inverse={selected}>
                  {' '}
                  {cleanModelName(item.model.name)}{' '}
                  <Text dimColor>
                    — {compactContext(item.model.contextLength)} ctx — {item.blurb ?? ''} — {tools} tools
                  </Text>
                </Text>
              );
            })
          )}
        </Box>
        <Text color={phase === 'tool-warning' ? 'yellow' : undefined} dimColor={phase !== 'tool-warning'}>
          {hint}
        </Text>
      </Box>
    );
  }

  const emptyMessage =
    providerChoice === 'ollama'
      ? ollamaModels === null
        ? 'Loading the models on this computer…'
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
      ? `This model can only chat, not do tasks · Enter use anyway · Esc pick another`
      : `Tab list · ↑↓ move · type to search · + favorite · Enter select · Esc back`;

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>{providerLabel(providerChoice)} — all models</Text>
      <Box>
        {TABS.map((name) => (
          <React.Fragment key={name}>
            <Text inverse={name === tab} dimColor={name !== tab}>
              {' '}
              {TAB_LABELS[name]} ({catalog.length && name === 'tools' ? catalog.filter(isToolCapable).length : name === 'all' ? catalog.length : poolFor(name, catalog, s.favorites, s.recents).length}){' '}
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
      <Text dimColor>memory in tokens (word pieces) · price per million tokens · ✓ tools · » fast</Text>
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
                  {backLabel()}
                </Text>
              );
            }
            if (item.kind === 'show-all') {
              return null;
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