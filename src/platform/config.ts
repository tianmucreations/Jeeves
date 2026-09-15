import Conf from 'conf';

// Persistent settings. Phase 7 expands this into the full config surface
// (default model, favourites, recents). API keys are NEVER stored here (spec 5.3).
const config = new Conf<{ hiddenMetrics?: string[] }>({ projectName: 'jeeves' });

const VALID_METRICS = ['session', 'context', 'today', 'credit', 'speed'];

// Metrics a power user has chosen to hide from the footer - hiding is opt-in, never required.
export function getHiddenMetrics(): string[] {
  const stored = config.get('hiddenMetrics') ?? [];
  return stored.filter((metric) => VALID_METRICS.includes(metric));
}

export function setHiddenMetrics(metrics: string[]): void {
  config.set('hiddenMetrics', metrics.filter((metric) => VALID_METRICS.includes(metric)));
}