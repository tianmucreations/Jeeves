import { session } from '../state/session.js';
import { resetStickySession } from '../providers/openrouter.js';
import { resetResearchGate } from '../agent/research-gate.js';

// Starts fresh: wipes the screen and the conversation the model remembers.
export function clearConversation(): void {
  session.clearTranscript();
  session.setHistory([]);
  session.setLastReasoning('');
  resetStickySession();
  resetResearchGate();
}