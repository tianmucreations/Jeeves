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
  models: ModelInfo[] = [];
  modelsNote = '';
  favorites: string[] = [];
  recents: string[] = [];
  tokensIn = 0;
  tokensOut = 0;
  cost = 0;
  footerExpanded: string | null = null;
  hiddenMetrics: string[] = [];
  creditUsed: number | null = null;
  creditRemaining: number | null = null;
  creditLimit: number | null = null;
  spend = 0;
  rateLimit: { limit: number; remaining: number; reset: number } | null = null;
  transcript: TranscriptEntry[] = [];
  history: ModelMessage[] = [];
  lastReasoning = '';

  private turnEvents: { t: number; tokens: number }[] = [];
  private creditBaselineUsed: number | null = null;

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

  setHistory(messages: ModelMessage[]): void {
    this.history = messages;
  }

  setLastReasoning(text: string): void {
    this.lastReasoning = text;
  }

  addUsage(input: number, output: number, cost: number): void {
    this.tokensIn += input;
    this.tokensOut += output;
    this.cost += cost;
    this.turnEvents.push({ t: Date.now(), tokens: input + output });
    const cutoff = Date.now() - 60_000;
    this.turnEvents = this.turnEvents.filter((event) => event.t >= cutoff);
    this.emit();
  }

  tokensPerMinute(): number {
    const cutoff = Date.now() - 60_000;
    return this.turnEvents.filter((event) => event.t >= cutoff).reduce((sum, event) => sum + event.tokens, 0);
  }

  setHiddenMetrics(metrics: string[]): void {
    this.hiddenMetrics = metrics;
    this.emit();
  }

  // Tab is an optional zoom-in: it expands one metric into a wide bar, cycling
  // through them and wrapping back to the always-visible compact view.
  tabFooter(): void {
    const all = ['session', 'context', 'today', 'credit', 'speed'];
    const visible = all.filter((metric) => !this.hiddenMetrics.includes(metric));
    if (visible.length === 0) {
      this.footerExpanded = null;
      this.emit();
      return;
    }
    if (this.footerExpanded === null) {
      this.footerExpanded = visible[0];
    } else {
      const index = visible.indexOf(this.footerExpanded);
      this.footerExpanded = visible[index + 1] ?? null;
    }
    this.emit();
  }

  escapeFooter(): void {
    this.footerExpanded = null;
    this.emit();
  }

  setCredit(used: number, limit: number, remaining: number): void {
    if (this.creditBaselineUsed === null) this.creditBaselineUsed = used;
    this.spend = Math.max(0, used - this.creditBaselineUsed);
    this.creditUsed = used;
    this.creditLimit = limit;
    this.creditRemaining = remaining;
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