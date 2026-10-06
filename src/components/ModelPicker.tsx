import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useInput, type Key } from 'ink';
import { ButtonRow, buttonAt, keyPress, type ButtonSpec } from './ButtonRow.js';
import { openInBrowser } from '../providers/openrouter-signin.js';
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
  openaiRoute,
  storeZaiKey,
  PROVIDER_ROWS,
  storeOpenRouterKey,
  refreshCredit,
  storeDirectKey,
  storeCustomService,
  removeOpenRouterKey,
  removeZaiKey,
  removeServiceKey,
  serviceKey,
  customServiceName,
} from '../providers/index.js';
import { directService, isDirectService, compatibleServices, CUSTOM_SERVICE_ID } from '../providers/direct-services.js';
import { loadDirectModels, loadCatalogue, checkCustomService } from '../providers/catalogue.js';
import { autoRowFor, noAutoNote } from '../agent/auto.js';
import { getCustomService } from '../platform/config.js';
import { OpenRouterConnect } from './OpenRouterConnect.js';
import { ChatGptConnect } from './ChatGptConnect.js';
import { OpenAIConnect } from './OpenAIConnect.js';
import { keyLooksValid } from '../commands/keys.js';
import { listLocalOllamaModels, isOllamaOnline } from '../providers/ollama.js';
import { ZAI_MODELS } from '../providers/zai.js';
import { isMouseSequence, parseMouseSequence, subscribeMouse } from '../ink/mouse.js';
import { HOW_IT_CONNECTS } from '../commands/settings.js';
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
  | { kind: 'disconnect' }
  | { kind: 'model'; model: ModelInfo; blurb?: string };
type Phase = 'browse' | 'tool-warning';
// Key entry happens inside the picker so a new user never leaves the flow.
// Simple thing first: providers, then a curated shortlist (big catalogs), then the full list on request.
// The compatible service asks for its address first, then its key.
type Step = 'providers' | 'more' | 'openai-method' | 'curated' | 'full' | 'key' | 'address' | 'limit';
// Which provider's catalog the picker is browsing: openrouter, zai, ollama, a
// model maker's id (a direct connection), or custom (the compatible service).
type ProviderChoice = string;

function providerLabel(provider: string): string {
  if (provider === CUSTOM_SERVICE_ID) return customServiceName();
  return PROVIDER_LABELS[provider] ?? directService(provider)?.label ?? provider;
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

// A plain-words row for a short list: the model, how much it can hold in mind, what it costs, and anything it cannot do.
function simpleRow(model: ModelInfo, inUse: boolean): string {
  return (
    (inUse ? ' ✓ ' : '   ') +
    column(model.name, 20) +
    column(`remembers ${compactContext(model.contextLength)}`, 20) +
    column(model.priceLabel === 'included' ? 'included in your plan' : compactPrice(model.promptPrice, model.completionPrice, model.priceLabel), 24) +
    (isToolCapable(model) ? '' : 'chat only  ') +
    (isFastModel(model) ? 'fast' : '')
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
  // The full provider list (OpenCode's Providers group): typed letters narrow it.
  const [moreQuery, setMoreQuery] = useState('');
  const [moreCursor, setMoreCursor] = useState(0);

  // The other AI companies come from a public list downloaded in the background; if they are not
  // here yet when this list opens, it is asked for again and the screen fills in when it arrives.
  const [, setCatalogueTick] = useState(0);
  useEffect(() => {
    if (compatibleServices().length > 0) return;
    let cancelled = false;
    void loadCatalogue().then(() => {
      if (!cancelled) setCatalogueTick((n) => n + 1);
    }, () => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
    if (start.step === 'more') {
      setStep('more');
      return;
    }
    const index = PROVIDER_ROWS.findIndex((row) => row.id === start.provider);
    if (index < 0) {
      if (start.provider && isDirectService(start.provider)) chooseProviderId(start.provider);
      return;
    }
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
  // A short list (Z.ai has four models) is a plain list: no tabs, no search, no column key.
  const simple = step === 'full' && providerChoice !== 'openrouter' && catalog.length > 0 && catalog.length <= 12;
  // A service without Auto says so in one line above its list.
  const autoNote = step === 'full' && !simple ? noAutoNote(providerChoice, providerLabel(providerChoice)) : null;
  const listHeight = Math.max(1, rows - 5 - (autoNote ? 1 : 0));

  // A connected provider can be disconnected from the foot of its own model list (keys used to be a separate, shorter list).
  const connectedNow = providerChoice !== 'ollama' && hasCredentialsFor(providerChoice);
  const [disconnectAsked, setDisconnectAsked] = useState(false);
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
      if (connectedNow) flat.push({ kind: 'disconnect' });
      return flat;
    }
    if (step === 'full') {
      const pool = poolFor(tab, catalog, s.favorites, s.recents);
      const matched = fuzzyMatch(pool, query);
      // A plain list has no Back row (a button does it) and no group headers, so the cursor starts on a model.
      const flat: Item[] = [simple ? { kind: 'header', label: '' } : { kind: 'back' }];
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
      if (connectedNow && !simple) flat.push({ kind: 'disconnect' });
      return flat;
    }
    return [];
  }, [step, tab, query, simple, catalog, s.favorites, s.recents, providerChoice, connectedNow]);

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

  // Every catalogue provider not already on the first list, narrowed by what was typed.
  function moreList() {
    const shown = new Set<string>(PROVIDER_ROWS.map((row) => row.id));
    const words = moreQuery.toLowerCase().split(/\s+/).filter(Boolean);
    return compatibleServices().filter((service) => !shown.has(service.id) && words.every((word) => `${service.label} ${service.id}`.toLowerCase().includes(word)));
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
    // The row under the services: every other provider, in a list of their own.
    if (index === PROVIDER_ROWS.length) {
      setMoreQuery('');
      setMoreCursor(0);
      setStep('more');
      return;
    }
    const row = PROVIDER_ROWS[index];
    if (row) chooseProviderId(row.id);
  }

  function chooseProviderId(id: string): void {
    // OpenAI is one entry in the lists: on the ChatGPT plan or an API key, whichever is connected;
    // if neither, the person is asked how they want to connect (as OpenCode does).
    if (id === 'openai') {
      const route = openaiRoute();
      if (!route) {
        setStep('openai-method');
        return;
      }
      return enterDirectStep(route);
    }
    const row = { id };
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

  // How many models each tab holds (also where a click on a tab lands).
  function tabCount(name: Tab): number {
    return catalog.length && name === 'tools' ? catalog.filter(isToolCapable).length : name === 'all' ? catalog.length : poolFor(name, catalog, s.favorites, s.recents).length;
  }

  // The window of the All providers list on screen (what is drawn and what a click means).
  function moreWindow() {
    const list = moreList();
    const cursor = Math.min(moreCursor, Math.max(0, list.length - 1));
    const height = Math.max(3, rows - 5);
    const first = Math.max(0, Math.min(cursor - Math.floor(height / 2), list.length - height));
    return { list, cursor, height, first };
  }

  function disconnectLabel(): string {
    return disconnectAsked ? `Click again to disconnect from ${providerLabel(providerChoice)} (you can connect again any time)` : `Disconnect from ${providerLabel(providerChoice)}`;
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

  async function disconnect(): Promise<void> {
    const id = providerChoice;
    if (id === 'openrouter') await removeOpenRouterKey();
    else if (id === 'zai') await removeZaiKey();
    else {
      await removeServiceKey(id);
      // OpenAI's row covers both ways of connecting: a ChatGPT plan and an API key.
      if (id === 'openai' || id === 'chatgpt') {
        await removeServiceKey('openai');
        await removeServiceKey('chatgpt');
      }
    }
    if (s.providerId === id) s.setStatus('disconnected');
    s.addNotice(`Disconnected from ${providerLabel(id)}.`);
    setDisconnectAsked(false);
    setStep('providers');
  }

  function selectHighlighted(): void {
    selectItem(resolved);
  }

  function selectItem(index: number): void {
    if (index < 0) return;
    const current = items[index];
    if (!current || current.kind === 'header') return;
    if (current.kind === 'disconnect') {
      // Two clicks (or two Enters): one slip never disconnects.
      if (!disconnectAsked) setDisconnectAsked(true);
      else void disconnect();
      return;
    }
    setDisconnectAsked(false);
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

  const handleInput = (input: string, key: Key) => {
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
          setKeyNote("Paste the provider's web address - its documentation gives it - or Esc");
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
    // ChatGPT's sign-in is its own explained screen too, and handles its own keys.
    if (step === 'openai-method') return;
    if (step === 'key' && (keyFor === 'openrouter' || keyFor === 'chatgpt')) return;
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
    if (step === 'more') {
      const list = moreList();
      if (key.escape) {
        setStep('providers');
      } else if (key.upArrow) {
        setMoreCursor((current) => Math.max(0, current - 1));
      } else if (key.downArrow) {
        setMoreCursor((current) => Math.min(list.length - 1, current + 1));
      } else if (key.return) {
        const chosen = list[Math.min(moreCursor, list.length - 1)];
        if (chosen) chooseProviderId(chosen.id);
      } else if (key.backspace || key.delete) {
        setMoreQuery((current) => current.slice(0, -1));
        setMoreCursor(0);
      } else if (input && !key.ctrl && !key.meta) {
        setMoreQuery((current) => current + input);
        setMoreCursor(0);
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
    if (key.tab && step === 'full' && !simple) {
      const next = TABS[(TABS.indexOf(tab) + 1) % TABS.length];
      setTab(next);
      setCursor(1);
      return;
    }
    if (key.backspace || key.delete) {
      if (step === 'full' && !simple) setQuery((current) => current.slice(0, -1));
      setCursor(1);
      return;
    }
    if (input === '+') {
      toggleFavorite();
      return;
    }
    if (!input || key.ctrl || key.meta) return;
    if (step === 'full' && !simple) {
      setQuery((current) => current + input);
      setCursor(1);
    }
  };
  useInput(handleInput);

  // The mouse works on every list here exactly as the keys do (owner, 30 Sept: some things clicked, others
  // needed the keyboard). It is off only while a key, an address or an amount is being typed, so the
  // terminal's own selecting and copying still work there.
  const typing = (step === 'key' && keyFor !== 'chatgpt' && keyFor !== 'openrouter') || step === 'address' || step === 'limit';
  // Buttons on the last row do exactly what the keys do (owner, 30 Sept: every screen must work by mouse too).
  const press = (over: Parameters<typeof keyPress>[0]) => () => handleInput('', keyPress(over));
  const back: ButtonSpec = { label: '← Back', run: press({ escape: true }) };
  const keyPage = keyFor === 'zai' ? 'https://z.ai/manage-apikey/apikey-list' : directService(keyFor)?.keyPage;
  const footerButtons: ButtonSpec[] =
    step === 'limit'
      ? [back, { label: 'Save', run: press({ return: true }) }]
      : step === 'address'
        ? [back, { label: 'Next', run: press({ return: true }) }]
        : step === 'key' && typing
          ? [
              back,
              { label: 'Save', run: press({ return: true }) },
              ...(keyPage ? [{ label: 'Open the page to get a key', run: () => openInBrowser(keyPage) }] : []),
            ]
          : step === 'providers' || step === 'more'
            ? [back]
            : simple
              ? [
                  back,
                  ...(connectedNow
                    ? [{ label: disconnectAsked ? `Click again to disconnect from ${providerLabel(providerChoice)}` : `Disconnect from ${providerLabel(providerChoice)}`, run: () => (disconnectAsked ? void disconnect() : setDisconnectAsked(true)) }]
                    : []),
                ]
              : [];
  const FooterLine = ({ hint }: { hint: string }) => (
    <Text>
      <ButtonRow buttons={footerButtons} />
      <Text dimColor>{'  ' + hint}</Text>
    </Text>
  );
  const onMouse = (report: string) => {
    if (phase === 'tool-warning') return;
    const event = parseMouseSequence(report);
    if (!event) return;
    if (event.kind === 'press' && event.button === 0 && event.row === rows && footerButtons.length > 0) {
      buttonAt(footerButtons, event.col)?.run();
      return;
    }
    if (typing) return;
    const wheel = event.kind === 'wheel' ? (event.button === 0 ? -1 : 1) : 0;
    const click = event.kind === 'press' && event.button === 0 ? event.row : 0;
    if (!wheel && !click) return;
    if (step === 'providers') {
      if (wheel) return setProviderCursor((c) => Math.max(0, Math.min(PROVIDER_ROWS.length, c + wheel)));
      // Title on row 1, a blank row, the providers from row 3, a blank row, then All providers.
      const index = click - 3;
      const target = index >= 0 && index < PROVIDER_ROWS.length ? index : click === 4 + PROVIDER_ROWS.length ? PROVIDER_ROWS.length : -1;
      if (target >= 0) {
        setProviderCursor(target);
        chooseProvider(target);
      }
      return;
    }
    if (step === 'more') {
      const { list, first, cursor } = moreWindow();
      if (wheel) return setMoreCursor(Math.max(0, Math.min(list.length - 1, cursor + wheel)));
      const chosen = list[first + (click - 5)];
      if (click >= 5 && chosen) chooseProviderId(chosen.id);
      return;
    }
    if (simple) {
      if (wheel) return setCursor(stepItem(items, resolved, wheel));
      // Title, a blank row, then one row per model.
      const models = items.filter((item) => item.kind === 'model');
      const chosen = models[click - 3];
      if (click >= 3 && chosen) {
        const index = items.indexOf(chosen);
        setCursor(index);
        selectItem(index);
      }
      return;
    }
    if (step === 'curated' || step === 'full') {
      if (wheel) return setCursor(stepItem(items, resolved, wheel));
      // The tabs sit on row 2 of the full list.
      if (step === 'full' && click === 2) {
        let column = 1;
        for (const name of TABS) {
          const width = ` ${TAB_LABELS[name]} (${tabCount(name)}) `.length;
          if (event.col >= column && event.col < column + width) {
            setTab(name);
            setCursor(1);
            return;
          }
          column += width + 1;
        }
        return;
      }
      const listTop = step === 'curated' ? 1 : 5 + (autoNote ? 1 : 0);
      const index = start + (click - listTop);
      if (click >= listTop && items[index] && items[index].kind !== 'header') {
        setCursor(index);
        selectItem(index);
      }
    }
  };
  const onMouseRef = useRef(onMouse);
  onMouseRef.current = onMouse;
  useEffect(() => subscribeMouse((report) => onMouseRef.current(report)), []);

  if (step === 'providers') {
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor wrap="truncate-end">{hasCredentials() ? 'Choose a provider' : 'Choose a provider - the company that runs the AI models. Connect one, once.'}</Text>
        <Text> </Text>
        <Box flexDirection="column" flexGrow={1}>
          {PROVIDER_ROWS.map((row, index) => {
            const enabled = providerEnabled(row.id);
            const selected = index === providerCursor;
            const how = HOW_IT_CONNECTS[row.id];
            return (
              <Text key={row.id} inverse={selected} dimColor={!enabled && !selected} wrap="truncate-end">
                {column((hasCredentialsFor(row.id) && row.id !== 'ollama' ? ' ✓ ' : '   ') + row.label, 19)}
                {enabled ? <Text dimColor>{how ?? rowDescription(row)}</Text> : <Text>{providerHint(row.id)}</Text>}
              </Text>
            );
          })}
          <Text> </Text>
          <Text inverse={providerCursor === PROVIDER_ROWS.length}>
            {column('   All providers', 19)}
            <Text dimColor>{compatibleServices().length > 0 ? `${compatibleServices().length}+ more - type to search` : 'more appear once online'}</Text>
          </Text>
        </Box>
        <FooterLine hint="click or ↑↓ Enter" />
      </Box>
    );
  }

  if (step === 'more') {
    const { list, cursor, height, first } = moreWindow();
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor>All providers - type to search</Text>
        <Text> </Text>
        <Text>{' '}<Text bold>Search: </Text>{'[ '}{moreQuery}<Text inverse> </Text>{' '.repeat(Math.max(0, 27 - moreQuery.length))} ]</Text>
        <Text> </Text>
        <Box flexDirection="column" flexGrow={1}>
          {list.length === 0 ? <Text dimColor>{' Nothing matches.'}</Text> : null}
          {list.slice(first, first + height).map((service, offset) => (
            <Text key={service.id} inverse={first + offset === cursor}>
              {column((hasCredentialsFor(service.id) ? ' ✓ ' : '   ') + service.label, 34)}
              <Text dimColor>API key</Text>
            </Text>
          ))}
        </Box>
        <FooterLine hint="click or ↑↓ Enter" />
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
        {limitNote ? <Text color="yellow">{limitNote}</Text> : null}
        <FooterLine hint={limitReturn === 'close' ? `Enter keeps $${current.toFixed(2)} · or type an amount` : 'type an amount'} />
      </Box>
    );
  }

  if (step === 'address') {
    return (
      <Box flexDirection="column" height={rows}>
        <Text dimColor>Other provider — any provider that accepts the OpenAI request format</Text>
        <Box flexDirection="column" flexGrow={1} justifyContent="center">
          <Text>
            <Text>Paste the provider's web address: </Text>
            <Text>{addressValue}</Text>
            <Text inverse> </Text>
          </Text>
          <Text dimColor>Its documentation gives it, for example https://api.together.xyz/v1</Text>
        </Box>
        {keyNote ? <Text color="yellow">{keyNote}</Text> : null}
        <FooterLine hint="paste the address" />
      </Box>
    );
  }

  if (step === 'openai-method') {
    return (
      <Box flexDirection="column" height={rows}>
        <OpenAIConnect
          onPlan={() => {
            setKeyFor('chatgpt');
            setStep('key');
          }}
          onKey={() => askForKey('openai')}
          onBack={() => setStep('providers')}
        />
      </Box>
    );
  }

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
  if (step === 'key' && keyFor === 'chatgpt') {
    return (
      <Box flexDirection="column" height={rows}>
        <ChatGptConnect
          onBack={() => setStep('providers')}
          onDone={(message) => {
            s.addNotice(message);
            if (s.status === 'disconnected') s.setStatus('idle');
            enterDirectStep('chatgpt');
          }}
        />
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
            ? `Other provider — ${addressValue.trim()}`
            : `${service} — a direct connection with your own key`;
    const where =
      keyFor === 'openrouter'
        ? ''
        : direct
          ? `Get one at ${direct.keyPage} (or click the button below). `
          : keyFor === CUSTOM_SERVICE_ID
            ? 'No key needed for a provider on this computer - just press Enter. '
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
        {keyNote ? <Text color="yellow">{keyNote}</Text> : null}
        <FooterLine hint="paste the key" />
      </Box>
    );
  }

  if (step === 'curated') {
    const picks = resolveCurated(catalog);
    const hint = `click or ↑↓ Enter to choose · + favorite · Esc back`;
    return (
      <Box flexDirection="column" height={rows}>
        <Box flexGrow={1} flexDirection="column" minHeight={listHeight}>
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
              if (item.kind === 'disconnect') {
                return (
                  <Text key="disconnect" inverse={selected} dimColor={!selected}>
                    {disconnectLabel()}
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
      : `click a model, or ↑↓ Enter · type to search · click a tab, or Tab · + favorite · Esc back`;

  if (simple) {
    return (
      <Box flexDirection="column" height={rows}>
        <Text>Choose a model for {providerLabel(providerChoice)}</Text>
        <Text> </Text>
        <Box flexDirection="column" flexGrow={1}>
          {items.map((item, index) =>
            item.kind === 'model' ? (
              <Text key={item.model.id} inverse={index === resolved} wrap="truncate-end">
                {simpleRow(item.model, item.model.id === s.model && providerChoice === (s.providerId as ProviderChoice))}
              </Text>
            ) : null,
          )}
        </Box>
        {phase === 'tool-warning' ? <Text color="yellow">This model can only chat, not do tasks · Enter use anyway · Esc pick another</Text> : null}
        <FooterLine hint="click a model, or ↑↓ Enter" />
      </Box>
    );
  }

  return (
    <Box flexDirection="column" height={rows}>
      <Text dimColor>{providerLabel(providerChoice)} — all models</Text>
      <Box>
        {TABS.map((name) => (
          <React.Fragment key={name}>
            <Text inverse={name === tab} dimColor={name !== tab}>
              {' '}
              {TAB_LABELS[name]} ({tabCount(name)}){' '}
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
            if (item.kind === 'disconnect') {
              return (
                <Text key="disconnect" inverse={selected} dimColor={!selected}>
                  {disconnectLabel()}
                </Text>
              );
            }
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