import { useSyncExternalStore } from 'react';
import type { ModelMessage } from 'ai';

export type Status = 'idle' | 'working' | 'awaiting-approval' | 'disconnected';

export type ToolLineState = 'awaiting' | 'running' | 'done' | 'failed' | 'declined';

export interface ToolLineData {
  tool: string;
  summary: string;
  state: ToolLineState;
  label: string;
}

export type TranscriptEntry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'notice'; text: string }
  | { id: number; kind: 'tool'; data: ToolLineData };

class SessionStore {
  model = 'z-ai/glm-5.3';
  providerId = 'openrouter';
  providerName = 'OpenRouter';
  status: Status = 'idle';
  approvalPending = false;
  tokensIn = 0;
  tokensOut = 0;
  cost = 0;
  transcript: TranscriptEntry[] = [];
  history: ModelMessage[] = [];
  reasoning = '';

  private nextId = 1;
  private version = 0;
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

  setHistory(messages: ModelMessage[]): void {
    this.history = messages;
  }

  setReasoning(text: string): void {
    this.reasoning = text;
  }

  addUsage(input: number, output: number, cost: number): void {
    this.tokensIn += input;
    this.tokensOut += output;
    this.cost += cost;
    this.emit();
  }
}

export const session = new SessionStore();

export function useSession(): SessionStore {
  useSyncExternalStore(session.subscribe, session.getSnapshot);
  return session;
}