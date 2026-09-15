import { session } from '../state/session.js';

interface PendingApproval {
  resolve: (approved: boolean) => void;
}

// Approvals are queued so that parallel tool calls never overwrite each other's prompt.
// The amber transcript prompt itself is rendered by the tool line in 'awaiting' state.
const queue: PendingApproval[] = [];

export function hasPendingApproval(): boolean {
  return queue.length > 0;
}

export function requestApproval(): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({ resolve });
    if (queue.length === 1) {
      session.setActiveApproval();
    }
  });
}

export function answerApproval(approved: boolean): void {
  const current = queue.shift();
  if (!current) return;
  current.resolve(approved);
  if (queue.length > 0) {
    session.setActiveApproval();
  } else {
    session.clearActiveApproval();
  }
}