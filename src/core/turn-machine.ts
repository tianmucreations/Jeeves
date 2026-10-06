// THE TURN MACHINE — one deterministic owner of "what is Jeeves doing right now".
//
// WHY THIS EXISTS (owner's order, 3 Oct: "deterministic state machine, no loose
// chaotic globals"): before this file, the window's idea of busy lived in loose
// flags that several files wrote directly. Two real bugs came from that:
//
//   1. THE STUCK-WINDOW BUG (his "text box missing" screenshot): a spending
//      question declined before a job started left `status` hard-coded to
//      "working" with NO job running — the typing box stayed hidden, new
//      messages queued forever, and only quitting recovered.
//   2. THE STATUS FIGHT: the quiet conversation-tidy stamped "idle" over a
//      running job, briefly letting a second message start inside the first.
//
// The design is Claude Code's, read from their published source
// (src/utils/QueryGuard.ts): an ATOMIC reserve that can never let two jobs run,
// a generation number so a stale job can never touch the machine, and ONE exit
// door (release) that always returns the window to a usable state.
//
// How the pieces map:
//   phase        — the fine state (starting / thinking / streaming / …)
//   status       — the coarse word the window already shows (idle / working /
//                  awaiting-approval / disconnected). THE LOOK NEVER CHANGES;
//                  only who is allowed to write it does.
//   generation   — a number bumped each time a job is reserved. Writes carry
//                  the number they belong to; an old job's late write is
//                  ignored instead of clobbering the new job.

export type TurnPhase =
  | 'idle' // nothing running — the only state a new job may start from
  | 'starting' // the job is accepted; checks and questions before any model call
  | 'processing' // the job's steps are running (tools working)
  | 'thinking' // the model is reasoning privately before writing
  | 'streaming' // the model is writing the answer
  | 'recovering' // a polite retry or resume after a stumble (rate limit, cut-off)
  | 'awaiting-approval' // a question waits for the person (Allow / Allow always / Decline)
  | 'disconnected'; // the account or connection is broken; the job is over

// The coarse status the screen already knows. Same four words as always.
export type TurnStatus = 'idle' | 'working' | 'awaiting-approval' | 'disconnected';

import { appendFileSync, mkdirSync } from 'node:fs';
import { settingsFolder } from '../platform/config.js';

// The fine states that all show as "working" on screen.
const WORKING_PHASES: ReadonlySet<TurnPhase> = new Set(['starting', 'processing', 'thinking', 'streaming', 'recovering']);

// Where a state may go next. Anything not in the table is refused and logged,
// so a mistake can never silently wedge the window again.
const LEGAL: Readonly<Record<TurnPhase, ReadonlySet<TurnPhase>>> = {
  // "disconnected" from idle: the picker and key screens report a broken account
  // between jobs (no turn involved) - the word must keep working there.
  idle: new Set(['starting', 'disconnected']),
  // "disconnected" from starting: a job can discover a dead account on its very
  // first request, before any model output - the flag must survive that too.
  starting: new Set(['processing', 'thinking', 'streaming', 'recovering', 'awaiting-approval', 'idle', 'disconnected']),
  processing: new Set(['processing', 'thinking', 'streaming', 'recovering', 'awaiting-approval', 'idle', 'disconnected']),
  thinking: new Set(['processing', 'thinking', 'streaming', 'recovering', 'awaiting-approval', 'idle', 'disconnected']),
  streaming: new Set(['processing', 'thinking', 'streaming', 'recovering', 'awaiting-approval', 'idle', 'disconnected']),
  recovering: new Set(['processing', 'thinking', 'streaming', 'recovering', 'awaiting-approval', 'idle', 'disconnected']),
  'awaiting-approval': new Set(['processing', 'thinking', 'streaming', 'recovering', 'idle', 'disconnected']),
  disconnected: new Set(['idle', 'starting']),
};

export class TurnMachine {
  private phase: TurnPhase = 'idle';
  // 0 means "no job is reserved". Every reserve() bumps it, so a stale job's
  // writes (carrying its old number) are recognised and refused.
  private generation = 0;
  // When a question appears, we remember which job asked it and what the job
  // was doing before — so answering it puts the job back EXACTLY where it was,
  // and answering it after the job died goes to idle, never to a fake "working"
  // (that was the stuck-window bug).
  private approvalReturn: TurnPhase = 'starting';
  private approvalOwner: number | null = null;
  private onChange: (() => void) | null = null;

  // The session store asks to be told whenever the coarse status may have changed.
  onStatusChange(listener: () => void): void {
    this.onChange = listener;
  }

  private status(): TurnStatus {
    if (this.phase === 'idle') return 'idle';
    if (this.phase === 'awaiting-approval') return 'awaiting-approval';
    if (this.phase === 'disconnected') return 'disconnected';
    return 'working';
  }

  private publish(): void {
    this.onChange?.();
  }

  // Whether a job is reserved right now (any phase including awaiting-approval,
  // which still belongs to the reserved job).
  get active(): boolean {
    return this.generation !== 0;
  }

  // The number of the job running now, or 0.
  get currentGeneration(): number {
    return this.generation;
  }

  get currentPhase(): TurnPhase {
    return this.phase;
  }

  // ── The three doors every job passes through ─────────────────────────────

  // Atomically claim the right to run one job. Returns the job's generation
  // number, or null when a job is already running — the caller then queues the
  // message instead of starting a second job (Claude Code's tryStart()).
  reserve(): number | null {
    // A broken connection does not lock Jeeves out: the next message may try again.
    if (this.phase !== 'idle' && this.phase !== 'disconnected') return null;
    this.generation += 1;
    this.phase = 'starting';
    this.publish();
    return this.generation;
  }

  // The ONE exit door. Runs in a finally, so however the job ends — finished,
  // declined, stopped, failed, crashed — the machine ends it exactly once and
  // the window can never be left pretending to work (the old stuck bug).
  release(generation: number): void {
    if (generation !== this.generation) return; // a stale job may not end a newer one
    // A broken connection stays broken on screen until the person tries again;
    // every other ending lands on idle.
    this.phase = this.phase === 'disconnected' ? 'disconnected' : 'idle';
    this.generation = 0;
    this.approvalOwner = null;
    this.publish();
  }

  // ── Guarded writes (the only ways the phase may change) ──────────────────

  // Move the job to a fine phase. A stale generation is ignored. An illegal
  // move is refused and logged, never applied blindly.
  to(phase: TurnPhase, generation: number): boolean {
    if (generation !== this.generation) return false;
    if (!LEGAL[this.phase].has(phase)) {
      // Refuse, tell the debug log (never the screen), and keep the window safe.
      // eslint-disable-next-line no-console
      this.log(`refused ${this.phase} -> ${phase}`);
      return false;
    }
    if (this.phase === phase) return true;
    this.phase = phase;
    this.publish();
    return true;
  }

  // The job is simply working (the coarse word older code still writes).
  // Inside a job this keeps the fine phase; only the machine may end the job.
  resumeWork(generation: number): void {
    if (generation !== this.generation) return;
    if (this.phase === 'awaiting-approval') this.restoreFromApproval();
    // Already in a working phase: nothing to do — the fine detail stays.
  }

  // Advisory note from anywhere inside the running job: a polite retry is under
  // way (rate limit back-off, cut-off resume). Applied only while a job is in a
  // working phase; no generation needed because only one job can exist.
  recover(): void {
    if (this.active && this.phase !== 'recovering' && LEGAL[this.phase].has('recovering')) {
      this.phase = 'recovering';
      this.publish();
    }
  }

  // A question appears. Remembers the job and the phase to return to.
  awaitApproval(generation: number | null): void {
    if (this.phase !== 'awaiting-approval') this.approvalReturn = this.phase;
    this.approvalOwner = generation !== null && generation === this.generation ? generation : null;
    this.phase = 'awaiting-approval';
    this.publish();
  }

  // The question was answered. If the asking job still lives, it goes back to
  // exactly what it was doing; if the job is already gone, the window goes to
  // idle — NEVER to a fake "working" (the stuck-window bug, fixed at the root).
  approvalAnswered(): void {
    if (this.phase !== 'awaiting-approval') return;
    if (this.approvalOwner !== null && this.approvalOwner === this.generation) {
      this.restoreFromApproval();
    } else {
      this.phase = 'idle';
      this.publish();
    }
  }

  private restoreFromApproval(): void {
    const back = WORKING_PHASES.has(this.approvalReturn) ? this.approvalReturn : 'processing';
    this.approvalOwner = null;
    this.phase = back;
    this.publish();
  }

  // The coarse status the window shows. Read by the session store.
  snapshotStatus(): TurnStatus {
    return this.status();
  }

  // The one door the old-style writers now go through (session.setStatus).
  // Each coarse word has a strict rule:
  //   idle         — a job may NOT write this while it still runs (that was the
  //                  stuck-window bug class); only release() ends a job.
  //   working      — only a running job may claim it; with no job it is refused,
  //                  so the window can never be left fake-busy again.
  //   disconnected — allowed wherever the table allows, with or without a job
  //                  (the picker and key screens use it between jobs).
  //   awaiting-approval — goes through awaitApproval, which remembers the way back.
  // Returns true when the word was applied (so the caller knows the screen changed).
  request(status: TurnStatus): boolean {
    if (status === 'idle') {
      if (this.active) {
        this.log('refused idle while a job is reserved (it must end through release)');
        return false;
      }
      return this.to('idle', 0);
    }
    if (status === 'working') {
      if (!this.active) {
        this.log('refused working with no reserved job (stuck-window guard)');
        return false;
      }
      this.resumeWork(this.generation);
      return true;
    }
    if (status === 'awaiting-approval') {
      this.awaitApproval(this.active ? this.generation : null);
      return true;
    }
    // disconnected
    if (!LEGAL[this.phase].has('disconnected')) {
      this.log(`refused ${this.phase} -> disconnected`);
      return false;
    }
    if (this.phase === 'disconnected') return true;
    this.phase = 'disconnected';
    this.publish();
    return true;
  }

  private log(line: string): void {
    // The machine sits under the whole app, so it must never import upwards;
    // these two imports (node:fs and the settings folder) point sideways/down only.
    try {
      mkdirSync(settingsFolder(), { recursive: true });
      appendFileSync(`${settingsFolder()}/jeeves-debug.log`, `${new Date().toISOString()} turn-machine: ${line}\n`);
    } catch {
      // Logging must never be the thing that breaks the app.
    }
  }
}

// The one machine for the whole app (Claude Code keeps one per screen; Jeeves
// has one window, so one module-level machine — created here, never reassigned).
export const turns = new TurnMachine();
