import type { ImageAttachment } from '../platform/images.js';
import { useSyncExternalStore } from 'react';
import type { ModelMessage } from 'ai';
import type { ModelInfo } from '../models/registry.js';
import { AUTO_MODEL_ID } from '../agent/auto-ids.js';
import { turns, type TurnStatus } from '../core/turn-machine.js';

// The four coarse words the window shows. The ONE definition now lives in the
// turn machine; this re-export keeps every existing import working unchanged.
export type Status = TurnStatus;

export type ToolLineState = 'awaiting' | 'running' | 'done' | 'failed' | 'declined' | 'held';

// Assumption: z-ai/glm-5.3's context length; the Phase 6 model registry replaces this constant.
export const DEFAULT_CONTEXT_TOKENS = 1_310_720;

export interface ToolLineData {
  tool: string;
  summary: string;
  state: ToolLineState;
  label: string;
  // Plain changed-lines shown above the question while a write waits for its
  // answer (write-safety's preview); cleared once the question is answered.
  detail?: string;
  // A finished look-around (read, list, search) leaves no line behind: the person
  // asked for an answer, not a diary of ticks (owner, 26 Sept). /verbose shows them.
  quiet?: boolean;
  // A merged group's finished sentence, whole (the clutter fix, 3 Oct): seven
  // "Changed 1 file" lines print as one "Changed 7 files".
  mergedText?: string;
}

export type TranscriptEntry =
  | { id: number; kind: 'user'; text: string }
  | { id: number; kind: 'assistant'; text: string }
  | { id: number; kind: 'reasoning'; text: string }
  | { id: number; kind: 'error'; text: string }
  | { id: number; kind: 'notice'; text: string }
  | { id: number; kind: 'tool'; data: ToolLineData };

class SessionStore {
  // Auto until the person chooses otherwise (decided 18 Sept): someone who
  // leaves the model list without picking still gets the recommended experience.
  model = AUTO_MODEL_ID;
  providerId = 'openrouter';
  providerName = 'OpenRouter';
  // The coarse status (idle / working / awaiting-approval / disconnected) lives
  // in the turn machine; this getter keeps every existing reader working.
  get status(): Status {
    return turns.snapshotStatus();
  }
  approvalPending = false;
  // Incremented each time a question arrives, so screens and the desktop can
  // tell a new question from the one before (a notification timer restarts).
  approvalSerial = 0;
  verbose = false;
  showLastReasoning = false;
  pickerOpen = false;
  keysOpen = false;
  wizardActive = false;
  helpOpen = false;
  chatsOpen = false;
  memoryOpen = false;
  rewindOpen = false;
  spendingOpen = false;
  settingsOpen = false;
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
  // The plan's own usage figures, read from Z.ai after turns: the 5-hour window
  // and the week, as percentages (owner, 24 Sept: "session and weekly" is what a
  // plan user needs - the same windows apply however many times Jeeves is opened).
  zaiQuota: { fiveHourPct: number; weeklyPct: number; fiveHourResetAt: string | null; weeklyResetAt: string | null } | null = null;
  // In Auto mode, the model actually working right now (worker or expert).
  activeModel: string | null = null;
  // True while quiet housekeeping (a summary) is running - shown in the info bar.
  tidying = false;
  // A short note for the info bar while something quick runs, like 'backing up…'.
  busyNote: string | null = null;
  // When the model began thinking privately before writing (ms), or null. Thinking
  // can last half a minute, so the screen says so instead of showing nothing.
  thinkingSince: number | null = null;
  // Something the model must be told with the next message (for example, that /undo ran).
  pendingContextNote: string | null = null;
  // The daily spending limit in dollars, and any extra allowance granted today.
  dailyLimit = 3;
  dailyExtra = 0;
  rateLimit: { limit: number; remaining: number; reset: number } | null = null;
  transcript: TranscriptEntry[] = [];
  history: ModelMessage[] = [];
  lastReasoning = '';
  // A short message that floats over the corner of the window and goes by itself
  // ("Copied to clipboard"), as OpenCode's toast does (ui/toast.tsx: top-right, over
  // the content, nothing moves). null when none is showing.
  toast: { text: string; kind: 'info' | 'error' } | null = null;
  private toastTimer: NodeJS.Timeout | null = null;
  showToast(text: string, kind: 'info' | 'error' = 'info', ms = 3000): void {
    this.toast = { text, kind };
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      this.toast = null;
      this.toastTimer = null;
      this.emit();
    }, ms);
    this.toastTimer.unref();
    this.emit();
  }
  // Text selected with the mouse in the conversation (Claude Code's in-app selection):
  // line and character positions within the drawn lines, so it stays on its words
  // while the view scrolls. null when nothing is selected.
  selection: { anchor: { line: number; ch: number }; focus: { line: number; ch: number } } | null = null;  // What the conversation area shows, published by the Transcript each time it draws,
  // so a mouse position can be turned into a line and character.
  // Set by the typing box: puts the cursor at a clicked screen position.
  inputClick: ((col: number, row: number) => void) | null = null;
  approvalClick: ((col: number, row: number) => void) | null = null;
  // Set by the info bar: opens Settings when its button is clicked; true if the click landed on it.
  // A click on a choice of the question panel; true when it landed on one.
  // The Picture button in the info bar: registered by the typing box.
  pictureButton: (() => void) | null = null;
  questionClick: ((col: number, row: number) => boolean) | null = null;
  // A click on a Stop button in the background-tasks panel; true when it landed on one.
  tasksClick: ((col: number, row: number) => boolean) | null = null;
  // How many rows the live tail currently occupies (set by the LiveTail each
  // frame, never emitted) - the click mappings need it to find their rows.
  liveTailRows = 0;
  // How many rows the printed history occupies on screen (set by the Feed;
  // once it passes the window height the block pins to the bottom).
  feedRows = 0;
  // Set by the entry point: hands the terminal a clean, homed viewport when a
  // full-height screen replaces the conversation.
  screenReset: (() => void) | null = null;
  footerClick: ((col: number, row: number) => boolean) | null = null;
  // WHERE THE LIVE BLOCK IS ON SCREEN. The window says how tall the block is and
  // its own best guess of where it starts; the terminal's answer to "where is the
  // cursor?" (ink/cursor-report.ts) is the truth and wins once it has come.
  blockHeight = 0;
  estimatedTop = 0;
  cursorRow = 0;
  // The row of the info bar (the buttons' click row); the typing area is two rows above it.
  get footerRow(): number {
    return this.cursorRow > 0 ? this.cursorRow - 1 : this.estimatedTop + this.blockHeight - 1;
  }
  // The row where the live block starts (everything above it is the terminal's own history).
  get blockTop(): number {
    return this.footerRow - this.blockHeight + 1;
  }
  // Set by the typing box: scrolls a message taller than the box when the wheel
  // turns over it (wherever mouse reporting is live); the conversation itself
  // scrolls with the terminal's own wheel.
  inputWheel: ((row: number, up: boolean) => boolean) | null = null;
  // Where the model list opens when Settings sends the person there: straight into
  // one service's models (all of them with full), or the daily limit. Read once.
  pickerStart: { provider?: string; full?: boolean; step?: 'limit' | 'more'; weekly?: boolean } | null = null;
  // Where the folder list opens when Settings sends the person there. Read once.
  folderPickerStart: 'list' | 'browse' | 'create' = 'list';
  // What is being typed in the input box (the window sizes the box to fit it).
  inputText = '';
  // Messages sent while Jeeves was busy, in order; each is sent when he finishes.
  queued: string[] = [];
  // Pictures that go with each queued message (same order).
  queuedImages: ImageAttachment[][] = [];
  // Pictures attached to the message being typed (each shown as [Image N] in the text).
  attachments: ImageAttachment[] = [];
  // Commands left running in the background (tools/background.ts), for the bottom bar.
  // The job's checklist (tools/todoList.ts), shown above the typing box while steps are left.
  // Plan first: only look around until the person has approved a plan (agent/plan.ts).
  planMode = false;
  // A question with choices waiting for the person (agent/question.ts).
  question: { question: string; options: { label: string; description?: string }[]; highlight: number } | null = null;
  todos: { content: string; status: 'pending' | 'in_progress' | 'completed' | 'cancelled' }[] = [];
  backgroundTasks: { id: number; plain: string; startedAt: number }[] = [];

  private turnEvents: { t: number; tokens: number }[] = [];

  private nextId = 1;
  private version = 0;
  private reasoningEntryId: number | null = null;
  private listeners = new Set<() => void>();

  constructor() {
    // The turn machine is the only authority on busy/quiet. When it changes the
    // coarse status, the window is redrawn - the store itself no longer decides.
    turns.onStatusChange(() => this.emit());
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): number => this.version;

  private lastEmit = 0;
  private emitTimer: NodeJS.Timeout | null = null;

  private emit(): void {
    this.version += 1;
    this.lastEmit = Date.now();
    for (const listener of this.listeners) listener();
  }

  // For the flood: tokens arrive faster than a screen can be redrawn, and every
  // emit redraws synchronously (useSyncExternalStore has no way to wait). At a
  // hundred or more tokens a second the redraws never let go of the program: in a
  // real window the main loop stalled for up to 7.7 SECONDS in a single answer, and
  // the wheel, the keys and every timer queued behind it - that was "I can't scroll
  // back until he has finished" and the jumpiness (26 Sept, measured with a
  // heartbeat). The text is stored at once; only the redraw is limited, to about
  // twenty a second - the way Claude Code throttles its own frames (16-32 ms).
  private emitThrottled(ms = 50): void {
    const wait = ms - (Date.now() - this.lastEmit);
    if (wait <= 0) {
      this.emit();
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit();
    }, wait);
  }

  setInputText(text: string): void {
    if (text === this.inputText) return;
    this.inputText = text;
    this.emit();
  }

  setPlanMode(on: boolean): void {
    this.planMode = on;
    this.emit();
  }

  setQuestion(question: SessionStore['question']): void {
    this.question = question;
    this.emit();
  }

  setQuestionHighlight(highlight: number): void {
    if (!this.question) return;
    this.question = { ...this.question, highlight };
    this.emit();
  }

  setTodos(todos: SessionStore['todos']): void {
    this.todos = todos;
    this.emit();
  }

  setBackgroundTasks(tasks: SessionStore['backgroundTasks']): void {
    this.backgroundTasks = tasks;
    this.emit();
  }

  // The background-tasks panel above the typing box (the door behind the blue
  // note in the info bar): open by /tasks or by clicking the note on screens
  // where the mouse is live. Shows each task with its own Stop button.
  tasksOpen = false;

  setTasksOpen(open: boolean): void {
    if (this.tasksOpen === open) return;
    this.tasksOpen = open;
    this.emit();
  }

  queueMessage(text: string, images: ImageAttachment[] = []): void {
    this.queued = [...this.queued, text];
    this.queuedImages = [...this.queuedImages, images];
    this.emit();
  }

  takeQueued(): string | undefined {
    return this.takeNext()?.text;
  }

  // The next waiting message with its pictures.
  takeNext(): { text: string; images: ImageAttachment[] } | undefined {
    if (this.queued.length === 0) return undefined;
    const [text, ...rest] = this.queued;
    const [images = [], ...restImages] = this.queuedImages;
    this.queued = rest;
    this.queuedImages = restImages;
    this.emit();
    return { text, images };
  }

  setAttachments(attachments: ImageAttachment[]): void {
    this.attachments = attachments;
    this.emit();
  }

  // One gate for "may this screen/command act now": a job is running, or a
  // question is waiting. Eleven copies of this test existed, and one had already
  // drifted (it forgot the question) - they all read this one now.
  busy(): boolean {
    return this.status === 'working' || this.approvalPending;
  }

  // The status is written only through the turn machine (core/turn-machine.ts):
  // a job can no longer stamp idle over another job, and nothing can stamp
  // working over an empty window - the two writes that caused the stuck-window
  // and status-fight bugs.
  setStatus(status: Status): void {
    turns.request(status);
  }

  setActiveApproval(): void {
    this.approvalPending = true;
    this.approvalSerial += 1;
    // The machine remembers which job asked and what it was doing, so the
    // answer returns the job EXACTLY to its own work.
    turns.awaitApproval(turns.currentGeneration !== 0 ? turns.currentGeneration : null);
    this.emit();
  }

  clearActiveApproval(): void {
    this.approvalPending = false;
    // Back to the asking job's own work - or to idle when the job is already
    // gone. The old hard-coded "working" here was the stuck-window bug.
    turns.approvalAnswered();
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
    this.emitThrottled();
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
    this.emitThrottled();
  }

  closeReasoningEntry(): void {
    this.reasoningEntryId = null;
  }

  addToolLine(tool: string, summary: string, state: ToolLineState, detail?: string): number {
    const id = this.nextId++;
    this.transcript = [...this.transcript, { id, kind: 'tool', data: { tool, summary, state, label: '', detail } }];
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
    if (this.busy()) {
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
    if (this.busy()) {
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

  // skipped: the person chose "not now" - straight to the conversation, not a second
  // list of services (audit 19 Sept).
  endWizard(skipped = false): void {
    this.wizardActive = false;
    const shouldOpenModelPicker = this.wizardFromLaunch && !skipped;
    this.wizardFromLaunch = false;
    this.emit();
    if (shouldOpenModelPicker) {
      this.openPicker();
    }
  }

  launchComplete(): void {
    this.launchStage = 'ready';
    this.switchingFolder = false;
    this.emit();
  }

  // /folder: the folder list again, from inside a conversation (owner, 19 Sept: from
  // "Just chat" there was no way into a folder). Between tasks only, like /model.
  switchingFolder = false;

  openFolderPicker(): void {
    if (this.busy()) {
      this.addNotice('The folder can be changed between tasks.');
      return;
    }
    this.switchingFolder = true;
    this.launchStage = 'project';
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
    if (this.launchStage === 'address') this.launchStage = 'project';
    // Always redraw: closing the screen without saving (Esc / Back) changes nothing else.
    this.emit();
  }

  openAddress(): void {
    if (this.busy()) {
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

  openSpending(): void {
    this.spendingOpen = true;
    this.emit();
  }

  closeSpending(): void {
    this.spendingOpen = false;
    this.emit();
  }

  openRewind(): void {
    this.rewindOpen = true;
    this.emit();
  }

  closeRewind(): void {
    this.rewindOpen = false;
    this.emit();
  }

  openMemory(): void {
    this.memoryOpen = true;
    this.emit();
  }

  closeMemory(): void {
    this.memoryOpen = false;
    this.emit();
  }

  openChats(): void {
    this.chatsOpen = true;
    this.emit();
  }

  closeChats(): void {
    this.chatsOpen = false;
    this.emit();
  }

  openSettings(): void {
    this.settingsOpen = true;
    this.emit();
  }

  closeSettings(): void {
    this.settingsOpen = false;
    this.emit();
  }

  requestExit(): void {
    this.exitRequested = true;
    this.emit();
  }

  // A saved conversation put back (platform/conversations.ts). A step that was still
  // running when it was saved is shown as finished, since nothing is running now.
  // Bumped whenever the conversation is replaced (/clear, resume): the printed
  // history feed remounts, because its append-only ledger belongs to one
  // conversation only.
  feedEpoch = 0;

  // The whole printed history is written again (after a resize re-wraps it).
  reprintHistory(): void {
    this.feedEpoch += 1;
    this.emit();
  }

  restoreConversation(transcript: TranscriptEntry[], history: ModelMessage[]): void {
    this.transcript = transcript.map((entry) =>
      entry.kind === 'tool' && (entry.data.state === 'running' || entry.data.state === 'awaiting') ? { ...entry, data: { ...entry.data, state: 'done' as const, detail: undefined } } : entry
    );
    this.nextId = transcript.reduce((max, entry) => Math.max(max, entry.id), 0) + 1;
    this.history = history;
    this.feedEpoch += 1;
    this.emit();
  }

  clearTranscript(): void {
    this.transcript = [];
    this.feedEpoch += 1;
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

  setThinking(on: boolean): void {
    if (on === (this.thinkingSince !== null)) return;
    this.thinkingSince = on ? Date.now() : null;
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

  setZaiQuota(quota: { fiveHourPct: number; weeklyPct: number; fiveHourResetAt: string | null; weeklyResetAt: string | null } | null): void {
    this.zaiQuota = quota;
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