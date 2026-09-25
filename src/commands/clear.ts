import { session } from '../state/session.js';
import { resetStickySession } from '../providers/openrouter.js';
import { resetResearchGate } from '../agent/research-gate.js';
import { resetBorrowedSearch } from '../tools/web/research.js';
import { resetSeenFiles } from '../tools/write-safety.js';
import { resetSummariser } from '../agent/context.js';
import { resetDoomLoop } from '../agent/doom-loop.js';

// Starts fresh: wipes the screen and the conversation the model remembers.
export function clearConversation(): void {
  session.clearTranscript();
  session.setHistory([]);
  session.setLastReasoning('');
  resetStickySession();
  resetResearchGate();
  resetBorrowedSearch();
  // A fresh conversation has seen no files, so read-before-write starts over,
  // and the summariser and doom-loop guard get their clean slates back.
  resetSeenFiles();
  resetSummariser();
  resetDoomLoop();
}