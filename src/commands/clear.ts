import { session } from '../state/session.js';

// Starts fresh: wipes the screen and the conversation the model remembers.
export function clearConversation(): void {
  session.clearTranscript();
  session.setHistory([]);
  session.setLastReasoning('');
}