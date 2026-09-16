import { session } from '../state/session.js';

// Reopens the first-launch question so the saved form of address can change.
export function openAddressPrompt(): void {
  session.openAddress();
}
