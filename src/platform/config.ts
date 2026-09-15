import Conf from 'conf';

interface JeevesConfig {
  hiddenMetrics?: string[];
  favorites?: string[];
  recents?: string[];
  modelCache?: { raw: unknown; fetchedAt: number };
}

// Persistent settings. Phase 7 expands this into the full config surface
// (default model, favourites, recents, verbose flag). API keys are NEVER stored here (spec 5.3).
const config = new Conf<JeevesConfig>({ projectName: 'jeeves' });

const VALID_METRICS = ['session', 'context', 'today', 'credit', 'speed'];

// Metrics a power user has chosen to hide from the footer - hiding is opt-in, never required.
export function getHiddenMetrics(): string[] {
  const stored = config.get('hiddenMetrics') ?? [];
  return stored.filter((metric) => VALID_METRICS.includes(metric));
}

export function setHiddenMetrics(metrics: string[]): void {
  config.set('hiddenMetrics', metrics.filter((metric) => VALID_METRICS.includes(metric)));
}

export function getFavorites(): string[] {
  return config.get('favorites') ?? [];
}

export function setFavorites(models: string[]): void {
  config.set('favorites', models);
}

export function getRecents(): string[] {
  return config.get('recents') ?? [];
}

export function setRecents(models: string[]): void {
  config.set('recents', models.slice(0, 10));
}

export function getModelCache(): { raw: unknown; fetchedAt: number } | null {
  return config.get('modelCache') ?? null;
}

export function setModelCache(raw: unknown, fetchedAt: number): void {
  config.set('modelCache', { raw, fetchedAt });
}