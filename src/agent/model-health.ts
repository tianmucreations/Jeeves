// Free models are more likely than paid ones to send unusual, hard-to-place errors
// or run out of their own request allowance - and a broken option left sitting in
// the recommended list just trips the next person too. This tracks, for this run of
// Jeeves only (nothing is written to disk - a model that was struggling yesterday
// deserves a clean slate today), which models have just failed repeatedly, so the
// Free list can quietly leave them out until they work again.
const FAILURES_BEFORE_UNRELIABLE = 2;

const consecutiveFailures = new Map<string, number>();

export function recordModelFailure(modelId: string): void {
  consecutiveFailures.set(modelId, (consecutiveFailures.get(modelId) ?? 0) + 1);
}

export function recordModelSuccess(modelId: string): void {
  consecutiveFailures.delete(modelId);
}

export function isModelUnreliable(modelId: string): boolean {
  return (consecutiveFailures.get(modelId) ?? 0) >= FAILURES_BEFORE_UNRELIABLE;
}
