import { session } from '../state/session.js';

export function openModelPicker(): void {
  session.openPicker();
}