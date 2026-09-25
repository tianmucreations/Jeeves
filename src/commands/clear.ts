import { session } from '../state/session.js';
import { resetStickySession } from '../providers/openrouter.js';
import { resetResearchGate } from '../agent/research-gate.js';
import { resetBorrowedSearch } from '../tools/web/research.js';
import { resetSeenFiles } from '../tools/write-safety.js';

// Starts fresh: wipes the screen and the conversation the model remembers.
export function clearConversation(): void {
  session.clearTranscript();
  session.setHistory([]);
  session.setLastReasoning('');
  resetStickySession();
  resetResearchGate();
  resetBorrowedSearch();
  // A fresh conversation has seen no files, so read-before-write starts over.
  resetSeenFiles();
}