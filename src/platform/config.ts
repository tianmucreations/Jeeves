import Conf from 'conf';

interface JeevesConfig {
  hiddenMetrics?: string[];
  favorites?: string[];
  recents?: string[];
  projects?: string[];
  modelCache?: { raw: unknown; fetchedAt: number };
  defaultModel?: string;
  defaultProvider?: string;
  verbose?: boolean;
}

// Persistent settings. Phase 7 expands this into the full config surface
// (default model, favourites, recents, verbose flag). API keys are NEVER stored here (spec 5.3).
// Tests run against their own settings file so they never touch - or race on - the real one.
const config = new Conf<JeevesConfig>({
  projectName: process.env.NODE_ENV === 'test' ? 'jeeves-tests' : 'jeeves',
});

const VALID_METRICS = ['session', 'context', 'cache', 'today', 'credit', 'speed'];

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

// Recently chosen project folders, newest first; the list grows automatically.
export function getRecentProjects(): string[] {
  return config.get('projects') ?? [];
}

export function setRecentProjects(projects: string[]): void {
  config.set('projects', projects.slice(0, 10));
}

export function getModelCache(): { raw: unknown; fetchedAt: number } | null {
  return config.get('modelCache') ?? null;
}

export function setModelCache(raw: unknown, fetchedAt: number): void {
  config.set('modelCache', { raw, fetchedAt });
}

// The default model and provider persist between sessions; API keys never do (spec 7).
export function getDefaultModel(): string | null {
  return config.get('defaultModel') ?? null;
}

export function setDefaultModel(model: string): void {
  config.set('defaultModel', model);
}

export function getDefaultProvider(): string | null {
  return config.get('defaultProvider') ?? null;
}

export function setDefaultProvider(provider: string): void {
  config.set('defaultProvider', provider);
}

export function getVerbosePreference(): boolean {
  return config.get('verbose') ?? false;
}

export function setVerbosePreference(value: boolean): void {
  config.set('verbose', value);
}