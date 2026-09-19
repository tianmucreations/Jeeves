import { session } from '../state/session.js';

// Quitting takes Ctrl+C twice within two seconds (Claude Code's rule), so a stray
// Ctrl+C - the copy key on Windows and Linux - never closes Jeeves and loses the
// conversation. The first press says so in the info bar.
const WINDOW_MS = 2000;
let firstPress = 0;
let noteTimer: NodeJS.Timeout | null = null;

export function pressCtrlCToQuit(now = Date.now()): void {
  if (now - firstPress <= WINDOW_MS) {
    session.requestExit();
    return;
  }
  firstPress = now;
  session.setBusyNote('press Ctrl+C again to quit');
  if (noteTimer) clearTimeout(noteTimer);
  noteTimer = setTimeout(() => {
    if (session.busyNote === 'press Ctrl+C again to quit') session.setBusyNote(null);
  }, WINDOW_MS);
}
