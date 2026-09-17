import { useSyncExternalStore } from 'react';
import type { ModelMessage } from 'ai';
import type { ModelInfo } from '../models/registry.js';

export type Status = 'idle' | 'working' | 'awaiting-approval' | 'disconnected';

export type ToolLineState = 'awaiting' | 'running' | 'done' | 'failed' | 'declined';

// Assumption: z-ai/glm-5.3's context length; the Phase 6 model registry replaces this constant.
export const DEFAULT_CONTEXT_TOKENS = 1_310_720;

export interface ToolLineData {
  tool: string;
  summary: string;
  state: ToolLineState;
  label: string;
}

export type TranscriptEntry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'reasoning'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'notice'; text: string }
  | { id: number; kind: 'tool'; data: ToolLineData };

class SessionStore {
  model = 'z-ai/glm-5.3';
  providerId = 'openrouter';
  providerName = 'OpenRouter';
  status: Status = 'idle';
  approvalPending = false;
  verbose = false;
  showLastReasoning = false;
  pickerOpen = false;
  keysOpen = false;
  wizardActive = false;
  helpOpen = false;
  exitRequested = false;
  launchStage: 'address' | 'project' | 'ready' = 'address';
  addressOpen = false;
  wizardFromLaunch = false;
  recentProjects: string[] = [];
  models: ModelInfo[] = [];
  modelsNote = '';
  favorites: string[] = [];
  recents: string[] = [];
  tokensIn = 0;
  tokensOut = 0;
  tokensCached = 0;
  cost = 0;
  creditUsed: number | null = null;
  creditRemaining: number | null = null;
  creditLimit: number | null = null;
  creditIsAccount = false;
  // Spent today on the OpenRouter key (local calendar day); null until first read.
  todaySpend: number | null = null;
  // When a flat-rate plan (Z.ai) has used up its allowance: the reset time it gave
  // (HH:MM, or '' if none was given); null while the plan has allowance.
  planResetAt: string | null = null;
  // In Auto mode, the model actually working right now (worker or expert).
  activeModel: string | null = null;
  // True while quiet housekeeping (a summary) is running - shown in the info bar.
  tidying = false;
  // A short note for the info bar while something quick runs, like 'backing up…'.
  busyNote: string | null = null;
  // Something the model must be told with the next message (for example, that /undo ran).
  pendingContextNote: string | null = null;
  // The daily spending limit in dollars, and any extra allowance granted today.
  dailyLimit = 3;
  dailyExtra = 0;
  rateLimit: { limit: number; remaining: number; reset: number } | null = null;
  transcript: TranscriptEntry[] = [];
  history: ModelMessage[] = [];
  lastReasoning = '';
  // Lines the transcript view is scrolled up from the bottom; 0 means "follow the newest".
  transcriptScrollUp = 0;
  // The furthest the transcript can scroll up (contentHeight - viewportHeight),
  // reported by the Transcript from its live measurements.
  transcriptScrollMax = Number.POSITIVE_INFINITY;

  private turnEvents: { t: number; tokens: number }[] = [];

  private nextId = 1;
  private version = 0;
  private reasoningEntryId: number | null = null;
  private listeners = new Set<() => void>();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  private emit(): void {
    this.version += 1;
    for (const listener of this.listeners) listener();
  }

  setStatus(status: Status): void {
    this.status = status;
    this.emit();
  }

  setActiveApproval(): void {
    this.approvalPending = true;
    this.status = 'awaiting-approval';
    this.emit();
  }

  clearActiveApproval(): void {
    this.approvalPending = false;
    this.status = 'working';
    this.emit();
  }

  setVerbose(value: boolean): void {
    this.verbose = value;
    this.emit();
  }

  toggleShowLastReasoning(): void {
    this.showLastReasoning = !this.showLastReasoning;
    this.emit();
  }

  addUser(text: string): void {
    this.transcript = [...this.transcript, { id: this.nextId++, kind: 'user', text }];
    this.emit();
  }

  addNotice(text: string): void {
    this.transcript = [...this.transcript, { id: this.nextId++, kind: 'notice', text }];
    this.emit();
  }

  addError(text: string): void {
    this.transcript = [...this.transcript, { id: this.nextId++, kind: 'error', text }];
    this.emit();
  }

  startAssistant(): number {
    const id = this.nextId++;
    this.transcript = [...this.transcript, { id, kind: 'assistant', text: '' }];
    this.emit();
    return id;
  }

  appendToken(id: number, token: string): void {
    this.transcript = this.transcript.map((entry) =>
      entry.id === id && entry.kind === 'assistant' ? { ...entry, text: entry.text + token } : entry
    );
    this.emit();
  }

  setAssistantText(id: number, text: string): void {
    this.transcript = this.transcript.map((entry) =>
      entry.id === id && entry.kind === 'assistant' ? { ...entry, text } : entry
    );
    this.emit();
  }

  finishAssistant(id: number): void {
    this.transcript = this.transcript.filter((entry) => !(entry.id === id && entry.kind === 'assistant' && entry.text === ''));
    this.emit();
  }

  beginTurn(): void {
    this.reasoningEntryId = null;
  }

  // Reasoning only renders while verbose is on; each model step gets its own block.
  appendReasoning(delta: string): void {
    if (this.reasoningEntryId === null) {
      const id = this.nextId++;
      this.transcript = [...this.transcript, { id, kind: 'reasoning', text: '' }];
      this.reasoningEntryId = id;
    }
    const target = this.reasoningEntryId;
    this.transcript = this.transcript.map((entry) =>
      entry.id === target && entry.kind === 'reasoning' ? { ...entry, text: entry.text + delta } : entry
    );
    this.emit();
  }

  closeReasoningEntry(): void {
    this.reasoningEntryId = null;
  }

  addToolLine(tool: string, summary: string, state: ToolLineState): number {
    const id = this.nextId++;
    this.transcript = [...this.transcript, { id, kind: 'tool', data: { tool, summary, state, label: '' } }];
    this.emit();
    return id;
  }

  updateToolLine(id: number, patch: Partial<ToolLineData>): void {
    this.transcript = this.transcript.map((entry) =>
      entry.kind === 'tool' && entry.id === id ? { ...entry, data: { ...entry.data, ...patch } } : entry
    );
    this.emit();
  }

  setModel(model: string): void {
    this.model = model;
    this.emit();
  }

  setProvider(providerId: string): void {
    this.providerId = providerId;
    this.emit();
  }

  setModels(models: ModelInfo[], note: string): void {
    this.models = models;
    this.modelsNote = note;
    this.emit();
  }

  setFavorites(models: string[]): void {
    this.favorites = models;
    this.emit();
  }

  setRecents(models: string[]): void {
    this.recents = models.slice(0, 10);
    this.emit();
  }

  openPicker(): void {
    if (this.status === 'working' || this.approvalPending) {
      this.addNotice('The model picker opens between tasks.');
      return;
    }
    this.pickerOpen = true;
    this.emit();
  }

  closePicker(): void {
    this.pickerOpen = false;
    this.emit();
  }

  openKeys(): void {
    if (this.status === 'working' || this.approvalPending) {
      this.addNotice('The key screens open between tasks.');
      return;
    }
    this.keysOpen = true;
    this.emit();
  }

  closeKeys(): void {
    this.keysOpen = false;
    this.emit();
  }

  startWizard(fromLaunch = false): void {
    this.wizardFromLaunch = fromLaunch;
    this.wizardActive = true;
    this.emit();
  }

  endWizard(): void {
    this.wizardActive = false;
    const shouldOpenModelPicker = this.wizardFromLaunch;
    this.wizardFromLaunch = false;
    this.emit();
    if (shouldOpenModelPicker) {
      this.openPicker();
    }
  }

  launchComplete(): void {
    this.launchStage = 'ready';
    this.emit();
  }

  // The address question runs before the project picker on first launch only;
  // index.tsx skips straight to the picker when an address is already saved.
  skipAddressStage(): void {
    if (this.launchStage === 'address') {
      this.launchStage = 'project';
      this.emit();
    }
  }

  addressDone(): void {
    this.addressOpen = false;
    if (this.launchStage === 'address') {
      this.launchStage = 'project';
      this.emit();
    }
  }

  openAddress(): void {
    if (this.status === 'working' || this.approvalPending) {
      this.addNotice('The address change happens between tasks.');
      return;
    }
    this.addressOpen = true;
    this.emit();
  }

  setRecentProjects(projects: string[]): void {
    this.recentProjects = projects.slice(0, 10);
    this.emit();
  }

  openHelp(): void {
    this.helpOpen = true;
    this.emit();
  }

  closeHelp(): void {
    this.helpOpen = false;
    this.emit();
  }

  requestExit(): void {
    this.exitRequested = true;
    this.emit();
  }

  clearTranscript(): void {
    this.transcript = [];
    this.transcriptScrollUp = 0;
    this.emit();
  }

  // Internal scrolling for the alternate-screen era: the terminal's own scrollback is
  // unavailable there, so the transcript region scrolls itself. Positive deltas go up
  // (older); the count is clamped between zero (the newest) and the measured maximum
  // (the oldest), so overshooting the top never leaves wheel or arrow presses to
  // unwind before the view moves again.
  scrollTranscript(delta: number): void {
    if (delta === 0) return;
    const next = Math.min(this.transcriptScrollMax, Math.max(0, this.transcriptScrollUp + delta));
    if (next === this.transcriptScrollUp) return;
    this.transcriptScrollUp = next;
    this.emit();
  }

  setTranscriptScrollMax(max: number): void {
    this.transcriptScrollMax = Math.max(0, max);
    if (this.transcriptScrollUp > this.transcriptScrollMax) {
      this.transcriptScrollUp = this.transcriptScrollMax;
      this.emit();
    }
  }

  followTranscript(): void {
    if (this.transcriptScrollUp === 0) return;
    this.transcriptScrollUp = 0;
    this.emit();
  }

  setHistory(messages: ModelMessage[]): void {
    this.history = messages;
  }

  setLastReasoning(text: string): void {
    this.lastReasoning = text;
  }

  addUsage(input: number, output: number, cost: number, cached = 0): void {
    this.tokensIn += input;
    this.tokensOut += output;
    this.tokensCached += cached;
    this.cost += cost;
    this.turnEvents.push({ t: Date.now(), tokens: input + output });
    const cutoff = Date.now() - 60_000;
    this.turnEvents = this.turnEvents.filter((event) => event.t >= cutoff);
    this.emit();
  }

  // Share of input tokens served from the provider's prompt cache - the at-a-glance
  // "is the money-saving working" number for the footer.
  cacheHitRate(): number | null {
    if (this.tokensIn <= 0) return null;
    return Math.min(1, this.tokensCached / this.tokensIn);
  }

  tokensPerMinute(): number {
    const cutoff = Date.now() - 60_000;
    return this.turnEvents.filter((event) => event.t >= cutoff).reduce((sum, event) => sum + event.tokens, 0);
  }

  setCredit(used: number, limit: number, remaining: number, accountWide: boolean): void {
    this.creditUsed = used;
    this.creditLimit = limit;
    this.creditRemaining = remaining;
    this.creditIsAccount = accountWide;
    this.emit();
  }

  setTodaySpend(amount: number): void {
    this.todaySpend = amount;
    this.emit();
  }

  setActiveModel(model: string | null): void {
    if (this.activeModel === model) return;
    this.activeModel = model;
    this.emit();
  }

  setBusyNote(note: string | null): void {
    if (this.busyNote === note) return;
    this.busyNote = note;
    this.emit();
  }

  setTidying(value: boolean): void {
    if (this.tidying === value) return;
    this.tidying = value;
    this.emit();
  }

  setDailyLimit(limit: number, extra = this.dailyExtra): void {
    this.dailyLimit = limit;
    this.dailyExtra = extra;
    this.emit();
  }

  setPlanResetAt(value: string | null): void {
    if (this.planResetAt === value) return;
    this.planResetAt = value;
    this.emit();
  }

  setRateLimit(info: { limit: number; remaining: number; reset: number } | null): void {
    this.rateLimit = info;
    this.emit();
  }

  // Assumption: roughly four characters per token is accurate enough for the context meter.
  estimateContextTokens(): number {
    return Math.ceil(JSON.stringify(this.history).length / 4);
  }
}

export const session = new SessionStore();

export function useSession(): SessionStore {
  useSyncExternalStore(session.subscribe, session.getSnapshot);
  return session;
}