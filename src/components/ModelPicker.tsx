import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import Fuse from 'fuse.js';
import { session, useSession } from '../state/session.js';
import { isToolCapable } from '../models/filter.js';
import { isModelUnreliable } from '../agent/model-health.js';
import {
  type ModelInfo,
  compactContext,
  compactPrice,
  isFastModel,
  resolveCurated,
  isFreeModel,
  cleanModelName,
} from '../models/registry.js';
import { setFavorites, setDailyLimit, hasSavedDailyLimit, getDefaultModel, getWeeklyLimit, setWeeklyLimit } from '../platform/config.js';
import { applyModelChoice } from '../models/choose.js';
import {
  hasCredentials,
  hasCredentialsFor,
  storeZaiKey,
  PROVIDER_ROWS,
  storeOpenRouterKey,
  refreshCredit,
  storeDirectKey,
  storeCustomService,
  serviceKey,
  customServiceName,
} from '../providers/index.js';
import { directService, isDirectService, CUSTOM_SERVICE_ID } from '../providers/direct-services.js';
import { loadDirectModels, checkCustomService } from '../providers/catalogue.js';
import { autoRowFor, noAutoNote } from '../agent/auto.js';
import { getCustomService } from '../platform/config.js';
import { OpenRouterConnect } from './OpenRouterConnect.js';
import { keyLooksValid } from '../commands/keys.js';
import { listLocalOllamaModels, isOllamaOnline } from '../providers/ollama.js';
import { ZAI_MODELS } from '../providers/zai.js';
import { isMouseSequence } from '../ink/mouse.js';
import { COPY_KEYS, KEY_STORE, KEY_STORE_SUBJECT } from '../platform/wording.js';

const TABS = ['favorites', 'recent', 'all', 'tools', 'free'] as const;
type Tab = (typeof TABS)[number];
const TAB_LABELS: Record<Tab, string> = {
  favorites: 'Favorites',
  recent: 'Recent',
  all: 'All',
  tools: 'Tool-capable',
  free: 'Free',
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
  xai: 'xAI (Grok)',
  groq: 'Groq',
  mistral: 'Mistral',
  ollama: 'Ollama',
};

type Item =
  | { kind: 'header'; label: string }
  | { kind: 'back' }
  | { kind: 'show-all' }
  | { kind: 'show-free'; count: number }
  | { kind: 'model'; model: ModelInfo; blurb?: string };
type Phase = 'browse' | 'tool-warning';
// Key entry happens inside the picker so a new user never leaves the flow.
// Simple thing first: providers, then a curated shortlist (big catalogs), then the full list on request.
// The compatible service asks for its address first, then its key.
type Step = 'providers' | 'curated' | 'full' | 'key' | 'address' | 'limit';
// Which provider's catalog the picker is browsing: openrouter, zai, ollama, a
// model maker's id (a direct connection), or custom (the compatible service).
type ProviderChoice = string;

function providerLabel(provider: string): string {
  if (provider === CUSTOM_SERVICE_ID) return customServiceName();
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
  // Free models that can do tasks - a free model that can only chat is no use here.
  // A free model that has just failed twice in a row is left out too, rather than
  // being offered again straight away as if nothing happened.
  if (tab === 'free') return models.filter((model) => isFreeModel(model) && isToolCapable(model) && !isModelUnreliable(model.id));
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
  // Which service the key prompt is for.
  const [keyFor, setKeyFor] = useState<string>('zai');
  // A direct connection's or the compatible service's models (null while loading).
  const [directModels, setDirectModels] = useState<ModelInfo[] | null>(null);
  const [addressValue, setAddressValue] = useState('');
  // True while a key is being checked with its company.
  const [checking, setChecking] = useState(false);
  // The browser sign-in in progress, so Esc can cancel it.
  const signInAbort = useRef<AbortController | null>(null);
  const [limitValue, setLimitValue] = useState('');
  const [limitNote, setLimitNote] = useState('');
  const [limitReturn, setLimitReturn] = useState<'providers' | 'close'>('providers');
  // True while the limit screen is editing the weekly limit instead of the daily one.
  const [limitWeekly, setLimitWeekly] = useState(false);
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

  // Sent here from Settings: straight into one service's models, or the daily limit.
  useEffect(() => {
    const start = session.pickerStart;
    session.pickerStart = null;
    if (!start) return;
    if (start.step === 'limit') {
      setLimitWeekly(start.weekly ?? false);
      setLimitReturn('close');
      setLimitValue('');
      setLimitNote('');
      setStep('limit');
      return;
    }
    const index = PROVIDER_ROWS.findIndex((row) => row.id === start.provider);
    if (index < 0) return;
    setProviderCursor(index);
    // Ollama is only known to be running a moment later, so it stays highlighted to choose.
    if (start.provider === 'ollama') return;
    chooseProvider(index);
    if (start.full && start.provider === 'openrouter' && hasCredentialsFor('openrouter')) {
      setStep('full');
      setCursor(1);
    }
  }, []);

  const catalog =
    providerChoice === 'ollama'
      ? (ollamaModels ?? [])
      : providerChoice === 'zai'
        ? ZAI_MODELS
        : providerChoice === 'openrouter'
          ? s.models
          : (directModels ?? []);
  // A service without Auto says so in one line above its list.
  const autoNote = step === 'full' ? noAutoNote(providerChoice, providerLabel(providerChoice)) : null;
  const listHeight = Math.max(1, rows - 5 - (autoNote ? 1 : 0));

  const items = useMemo<Item[]>(() => {
    if (step === 'curated') {
      const picks = resolveCurated(catalog);
      const flat: Item[] = [{ kind: 'back' }, { kind: 'header', label: 'Recommended' }];
      for (const pick of picks) {
        flat.push({ kind: 'model', model: pick.model, blurb: pick.blurb });
      }
      flat.push({ kind: 'header', label: '──────────' }, { kind: 'show-all' });
      const freeCount = catalog.filter((model) => isFreeModel(model) && isToolCapable(model) && !isModelUnreliable(model.id)).length;
      if (freeCount > 0) flat.push({ kind: 'show-free', count: freeCount });
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

  // Every row does something when chosen: each service asks for its key right here
  // if it is missing (the compatible service for its address first).
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

  // The compatible service's row names it once it has been added.
  function rowDescription(row: { id: string; description: string }): string {
    if (row.id === CUSTOM_SERVICE_ID && hasCredentialsFor(CUSTOM_SERVICE_ID)) return `${customServiceName()} - your compatible service`;
    return row.description;
  }

  function askForKey(service: string): void {
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

  // A direct connection or the compatible service: its models load from the company.
  function enterDirectStep(forProvider: string): void {
    setProviderChoice(forProvider);
    setQuery('');
    setTab('all');
    setCursor(1);
    setDirectModels(null);
    setStep('full');
    const loading =
      forProvider === CUSTOM_SERVICE_ID
        ? checkCustomService(getCustomService()?.baseURL ?? '', serviceKey(CUSTOM_SERVICE_ID) ?? '').then((check) => (check.ok ? check.models : []))
        : isDirectService(forProvider)
          ? loadDirectModels(forProvider, serviceKey(forProvider) ?? '').then((models) => {
              // Auto heads the list where the company has it (OpenAI).
              const auto = autoRowFor(forProvider, models);
              return auto ? [auto, ...models] : models;
            })
          : Promise.resolve([]);
    void loading.then(setDirectModels).catch(() => setDirectModels([]));
  }

  function chooseProvider(index = providerCursor): void {
    // The row under the services: the daily spending limit.
    if (index === PROVIDER_ROWS.length) {
      setLimitReturn('providers');
      setLimitValue('');
      setLimitNote('');
      setStep('limit');
      return;
    }
    const row = PROVIDER_ROWS[index];
    if (!row) return;
    if (row.id === 'openrouter') {
      if (!hasCredentialsFor('openrouter')) return askForKey('openrouter');
      enterModelStep('openrouter');
    } else if (row.id === 'zai') {
      if (!hasCredentialsFor('zai')) return askForKey('zai');
      enterModelStep('zai');
    } else if (isDirectService(row.id)) {
      if (!hasCredentialsFor(row.id)) return askForKey(row.id);
      enterDirectStep(row.id);
    } else if (row.id === CUSTOM_SERVICE_ID) {
      if (!hasCredentialsFor(CUSTOM_SERVICE_ID)) {
        setAddressValue('');
        setKeyNote('');
        setStep('address');
        return;
      }
      enterDirectStep(CUSTOM_SERVICE_ID);
    } else if (row.id === 'ollama') {
      if (ollamaOnline !== true) return;
      enterModelStep('ollama');
      void listLocalOllamaModels()
        .then(setOllamaModels)
        .catch(() => setOllamaModels([]));
    }
  }

  function goBack(): void {
    if (step === 'key' || step === 'address') {
      setKeyValue('');
      setKeyNote('');
      setStep(step === 'key' && keyFor === CUSTOM_SERVICE_ID ? 'address' : 'providers');
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
    applyModelChoice(providerChoice, model.id);
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
    if (current.kind === 'show-all' || current.kind === 'show-free') {
      setStep('full');
      setQuery('');
      setTab(current.kind === 'show-free' ? 'free' : 'all');
      setCursor(1);
      return;
    }
    const model = current.model;
    // Choosing the model already in use just closes - unless nothing was ever chosen,
    // so a first choice of the starting model (Auto) still saves it and sets the daily limit.
    if (model.id === s.model && providerChoice === (s.providerId as ProviderChoice) && getDefaultModel() !== null) {
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
    finishChoice(model);
  }

  // The first time a model that costs money is chosen, the daily limit is set, so
  // spending is visible in the bar from the first message.
  function finishChoice(model: ModelInfo): void {
    const paid = providerChoice === 'openrouter' || isDirectService(providerChoice);
    if (paid && !isFreeModel(model) && !hasSavedDailyLimit()) {
      setLimitReturn('close');
      setLimitValue('');
      setLimitNote('');
      setStep('limit');
      return;
    }
    s.closePicker();
  }

  useInput((input, key) => {
    if (isMouseSequence(input)) return;
        if (phase === 'tool-warning') {
      if (key.return) {
        if (pending) {
          applyModel(pending);
          finishChoice(pending);
        } else {
          s.closePicker();
        }
      } else if (key.escape) {
        setPhase('browse');
      }
      return;
    }
    if (step === 'address') {
      if (key.escape) {
        goBack();
        return;
      }
      if (key.return) {
        if (addressValue.trim().length < 4) {
          setKeyNote("Paste the service's web address - its documentation gives it - or Esc");
          return;
        }
        askForKey(CUSTOM_SERVICE_ID);
        return;
      }
      if (key.backspace || key.delete) {
        setAddressValue((v) => v.slice(0, -1));
        return;
      }
      if (!input || key.ctrl || key.meta) return;
      setKeyNote('');
      setAddressValue((v) => v + input);
      return;
    }
    // OpenRouter's key step is its own explained screen, which handles its own keys.
    if (step === 'key' && keyFor === 'openrouter') return;
    if (step === 'key' && keyFor === 'openrouter') {
    return (
      <Box flexDirection="column" height={rows}>
        <OpenRouterConnect
          hasKey={false}
          onBack={() => setStep('providers')}
          onDone={(message) => {
            // Said in the conversation too - including "no credit yet" for a new account.
            s.addNotice(message);
            if (s.status === 'disconnected') s.setStatus('idle');
            enterModelStep('openrouter');
          }}
        />
      </Box>
    );
  }
  if (step === 'key') {
      if (checking) {
        if (key.escape && signInAbort.current) signInAbort.current.abort();
        return;
      }
      if (key.escape) {
        goBack();
        return;
      }
      if (key.return && keyFor === CUSTOM_SERVICE_ID) {
        // A service on this computer may need no key, so an empty key is allowed here.
        setChecking(true);
        setKeyNote(`Checking ${addressValue.trim()}…`);
        void storeCustomService(addressValue, keyValue.trim()).then((result) => {
          setChecking(false);
          setKeyValue('');
          if (result === 'saved' || result === 'saved-unchecked') {
            if (result === 'saved-unchecked') {
              s.addNotice(`${customServiceName()} shows its models to anyone, so the key couldn't be checked yet. If it's wrong, you'll be told on your first message.`);
            }
            setKeyNote('');
            enterDirectStep(CUSTOM_SERVICE_ID);
          } else if (result === 'rejected') {
            setKeyNote("The service didn't accept that key - paste it again, or Esc");
          } else if (result === 'keychain') {
            setKeyNote(`${KEY_STORE_SUBJECT} was not reachable - press Enter and try again.`);
          } else {
            setStep('address');
            setKeyNote("Couldn't find a compatible service at that address - check it, or Esc");
          }
        });
        return;
      }
      if (key.return && isDirectService(keyFor)) {
        const trimmed = keyValue.trim();
        const label = directService(keyFor)!.label;
        if (!keyLooksValid(trimmed, keyFor)) {
          setKeyNote('That looks too short to be a key - paste it again, or Esc');
          setKeyValue('');
          return;
        }
        setChecking(true);
        setKeyNote(`Checking the key with ${label}…`);
        void storeDirectKey(keyFor, trimmed).then((result) => {
          setChecking(false);
          setKeyValue('');
          if (result === 'rejected') {
            setKeyNote(`${label} didn't accept that key - paste it again, or Esc`);
            return;
          }
          if (result === 'keychain') {
            setKeyNote(`${KEY_STORE_SUBJECT} was not reachable - press Enter and try again.`);
            return;
          }
          if (result === 'saved-unchecked') {
            s.addNotice(`Your ${label} key is saved, but ${label} couldn't be reached to check it. If it's wrong, you'll be told on your first message.`);
          }
          setKeyNote('');
          if (s.status === 'disconnected') s.setStatus('idle');
          enterDirectStep(keyFor);
        });
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
            setKeyNote(`${KEY_STORE_SUBJECT} was not reachable - press Enter and try again.`);
            return;
          }
          if (keyFor === 'zai') {
            enterModelStep('zai');
          } else {
            void refreshCredit();
            if (s.status === 'disconnected') s.setStatus('idle');
            enterModelStep('openrouter');
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
      const done = () => (limitReturn === 'close' ? s.closePicker() : setStep('providers'));
      // From a model choice, Esc or an empty Enter keeps the suggested limit.
      if (key.escape || (key.return && limitValue === '' && limitReturn === 'close')) {
        if (limitReturn === 'close') {
          // Keeping the weekly limit pins the default (7× the daily one) as a real choice.
          if (limitWeekly) setWeeklyLimit(getWeeklyLimit());
          else setDailyLimit(s.dailyLimit);
        }
        done();
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
        if (limitWeekly) setWeeklyLimit(rounded);
        else {
          setDailyLimit(rounded);
          s.setDailyLimit(rounded);
        }
        done();
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
                {enabled ? <Text dimColor>{rowDescription(row)}</Text> : <Text>{providerHint(row.id)}</Text>}
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
    const weekly = limitWeekly;
    const current = weekly ? getWeeklyLimit() : s.dailyLimit;
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor>{weekly ? 'Weekly spending limit' : 'Daily spending limit'}</Text>
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <Text>
            <Text>Most to spend in a {weekly ? 'week' : 'day'}, in dollars (now ${current.toFixed(2)}): </Text>
            <Text>{limitValue}</Text>
            <Text inverse> </Text>
          </Text>
          <Text dimColor>
            {weekly
              ? "When this week's spending reaches it, Jeeves stops and asks before spending more."
              : "When today's spending reaches it, Jeeves stops and asks before spending more."}
          </Text>
        </Box>
        {limitNote ? (
          <Text color="yellow">{limitNote}</Text>
        ) : (
          <Text dimColor>
            {limitReturn === 'close'
              ? `Enter keeps $${current.toFixed(2)} · or type an amount, then Enter`
              : 'type an amount · Enter save · Esc back'}
          </Text>
        )}
      </Box>
    );
  }

  if (step === 'address') {
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor>Other service — any service that accepts the OpenAI request format</Text>
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <Text>
            <Text>Paste the service's web address: </Text>
            <Text>{addressValue}</Text>
            <Text inverse> </Text>
          </Text>
          <Text dimColor>Its documentation gives it, for example https://api.together.xyz/v1</Text>
        </Box>
        {keyNote ? <Text color="yellow">{keyNote}</Text> : <Text dimColor>paste the address · Enter next · Esc back</Text>}
      </Box>
    );
  }

  if (step === 'key') {
    const direct = directService(keyFor);
    const service = keyFor === 'openrouter' ? 'OpenRouter' : keyFor === 'zai' ? 'Z.ai' : keyFor === CUSTOM_SERVICE_ID ? 'service' : (direct?.label ?? keyFor);
    const title =
      keyFor === 'openrouter'
        ? 'OpenRouter — one key unlocks 400+ models'
        : keyFor === 'zai'
          ? 'Z.ai — GLM Coding Plan'
          : keyFor === CUSTOM_SERVICE_ID
            ? `Other service — ${addressValue.trim()}`
            : `${service} — a direct connection with your own key`;
    const where =
      keyFor === 'openrouter'
        ? ''
        : direct
          ? `Get one at ${direct.keyPage} (select it with the mouse, ${COPY_KEYS} to copy). `
          : keyFor === CUSTOM_SERVICE_ID
            ? 'No key needed for a service on this computer - just press Enter. '
            : '';
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor>{title}</Text>
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <Text>
            <Text>Paste your {service} API key (it stays hidden): </Text>
            <Text dimColor>{keyValue ? `${keyValue.length} characters ` : ''}</Text>
            <Text inverse> </Text>
          </Text>
          <Text dimColor>{where}It is stored in {KEY_STORE} and never shown again.</Text>
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
              if (item.kind === 'show-free') {
                return (
                  <Text key="showfree" inverse={selected} dimColor={!selected}>
                    Free models ({item.count}) - no charge, a daily limit on requests →
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
      : providerChoice !== 'openrouter' && providerChoice !== 'zai'
        ? directModels === null
          ? `Loading the ${providerLabel(providerChoice)} models…`
          : directModels.length === 0
            ? `Couldn't load the ${providerLabel(providerChoice)} models - check the internet connection, then open /model again.`
            : items.length <= 1
              ? query
                ? `No models match "${query}".`
                : 'No models in this list.'
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
      <Text dimColor>
        {tab === 'free'
          ? 'free models: no charge, but OpenRouter limits requests per day · » fast'
          : 'memory in tokens (word pieces) · price per million tokens · ✓ tools · » fast'}
      </Text>
      {autoNote ? <Text color="yellow">{autoNote}</Text> : null}
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
            if (item.kind === 'show-all' || item.kind === 'show-free') {
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