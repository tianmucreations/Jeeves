// THE BUFFER GUARD — stdout, stderr and everything printed by mistake are kept
// strictly apart (owner's order, 3 Oct: "keep stdout, stderr and LLM text
// buffers strictly separated so they never corrupt the visual layout").
//
// What each channel is allowed to do after this guard is installed:
//   stdout  — Ink, the screen renderer, is the ONLY writer (exactly as Claude
//             Code does: "Not patching process.stdout - Ink itself writes
//             there"). The app's six raw stdout writes are terminal control
//             sequences (alt screen enter/leave, mouse on/off, cursor) and are
//             each already guarded.
//   stderr  — SWALLOWED into the debug log. A stray write from any library
//             used to land in the middle of the window and corrupt the frame;
//             now it lands in a file instead. Nothing is lost: it is all in
//             jeeves-debug.log in the settings folder.
//   console — REROUTED into the debug log, same reason. (The app itself was
//             already clean - one console.error before the window exists - but
//             a dependency printing mid-session is out of our hands.)
//   LLM text — only ever enters through the session store and the renderer;
//             nothing here changes that.
//
// Also here: the crash guards. An uncaught error used to be able to kill the
// process with the terminal still in Jeeves's full-screen mode - mouse trapped,
// cursor gone. Now the terminal is ALWAYS handed back first, then a plain
// English line is shown (Claude Code's cleanupRegistry + failsafe exit).

import { appendFileSync, mkdirSync, statSync, unlinkSync } from 'node:fs';
import { settingsFolder } from '../platform/config.js';

// The debug log lives with the rest of Jeeves's own files. It is capped: past
// 1 MB it starts over, so it can never grow without bound.
const MAX_LOG_BYTES = 1_000_000;

export function debugLogPath(): string {
  return `${settingsFolder()}/jeeves-debug.log`;
}

// One line into the debug log. Best effort by design: logging must never be
// the thing that breaks the app, so every failure here is silently ignored.
export function debugLog(line: string): void {
  try {
    mkdirSync(settingsFolder(), { recursive: true });
    try {
      if (statSync(debugLogPath()).size > MAX_LOG_BYTES) unlinkSync(debugLogPath());
    } catch {
      // Missing file is fine - the first write creates it.
    }
    appendFileSync(debugLogPath(), `${new Date().toISOString()} ${line}\n`);
  } catch {
    // Nothing sensible left to do; the terminal must keep working.
  }
}

type StderrWrite = (buffer: Uint8Array | string, encoding?: BufferEncoding, cb?: (err?: Error) => void) => boolean;

// Swallow stderr and console into the debug log. Called once, right before the
// window is created - the one plain-English "open a Terminal" error still
// prints normally, because it fires before this.
export function installBufferGuard(): void {
  const originalWrite = process.stderr.write.bind(process.stderr) as StderrWrite;
  const guarded: StderrWrite = (buffer, _encoding, cb) => {
    debugLog(`stderr: ${String(buffer).replace(/\n+$/, '')}`);
    // The write is reported as done; nobody is listening on this channel.
    cb?.();
    return true;
  };
  process.stderr.write = guarded as typeof process.stderr.write;
  const methods = ['log', 'info', 'warn', 'error', 'debug', 'trace'] as const;
  for (const method of methods) {
    console[method] = (...args: unknown[]) => {
      debugLog(`console.${method}: ${args.map(String).join(' ')}`);
    };
  }
}

// The last-resort exit: hand the terminal back, say one plain line, and make
// sure the process DIES even if something hangs during cleanup (Claude Code's
// forceExit: process.kill with SIGKILL after a short failsafe timer).
export function forceExitSoon(code: number, message?: string): void {
  if (message) {
    try {
      // Synchronous, straight to the real channel, AFTER terminal restore.
      process.stdout.write(message);
    } catch {
      // A dead terminal cannot be written to; the exit still proceeds.
    }
  }
  const failsafe = setTimeout(() => {
    try {
      process.kill(process.pid, 'SIGKILL');
    } catch {
      // Nothing more can be done.
    }
  }, 2000);
  failsafe.unref();
  process.exit(code);
}

// Crash guards for the whole process. The cleanup work (ending commands,
// leaving full-screen mode) is passed in by the entry point, so this module
// never imports upwards - no cycles.
export function installCrashGuards(cleanup: () => void): void {
  process.on('uncaughtException', (error) => {
    debugLog(`uncaught exception: ${error?.stack ?? String(error)}`);
    try {
      cleanup();
    } catch {
      // Even broken cleanup must not stop the exit.
    }
    forceExitSoon(1, 'Something went wrong inside Jeeves and it had to close. The terminal is back to normal - you can start Jeeves again.\n');
  });
  // A rejected promise alone does not end the app (Claude Code logs and carries
  // on too): the job in flight reports its own plain error through the loop.
  process.on('unhandledRejection', (reason) => {
    debugLog(`unhandled rejection: ${reason instanceof Error ? reason.stack : String(reason)}`);
  });
}
