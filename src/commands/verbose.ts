import { session } from '../state/session.js';

// Toggles the permanent reasoning trace; default is off (spec 2.3).
export function toggleVerbose(): string {
  session.setVerbose(!session.verbose);
  return session.verbose ? 'Verbose reasoning: on' : 'Verbose reasoning: off';
}