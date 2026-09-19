import path from 'node:path';
import Conf from 'conf';
import type { SpendReading } from '../state/today-spend.js';

interface JeevesConfig {
  spendReading?: SpendReading;
  dailyLimit?: number;
  dailyExtra?: { date: string; amount: number };
  favorites?: string[];
  recents?: string[];
  projects?: string[];
  modelCache?: { raw: unknown; fetchedAt: number };
  defaultModel?: string;
  defaultProvider?: string;
  verbose?: boolean;
  address?: string;
  directCatalogue?: { catalogue: unknown; fetchedAt: number };
  customService?: { baseURL: string };
  estimatedSpend?: { date: string; amount: number };
  trustedProjects?: string[];
}

// Persistent settings. Phase 7 expands this into the full config surface
// (default model, favourites, recents, verbose flag). API keys are NEVER stored here (spec 5.3).
// Tests run against their own settings file so they never touch - or race on - the real one.
const config = new Conf<JeevesConfig>({
  projectName: process.env.NODE_ENV === 'test' ? 'jeeves-tests' : 'jeeves',
});

// The folder Jeeves keeps its settings in (chosen by the conf library for each
// operating system); backups live in a "checkpoints" folder beside the settings.
export function settingsFolder(): string {
  return path.dirname(config.path);
}

// The daily spending limit in dollars (default $3).
export function getDailyLimit(): number {
  const stored = config.get('dailyLimit');
  return typeof stored === 'number' && stored > 0 ? stored : 3;
}

// Whether a limit has ever been chosen - the first paid model choice asks for one.
export function hasSavedDailyLimit(): boolean {
  return typeof config.get('dailyLimit') === 'number';
}

export function setDailyLimit(limit: number): void {
  config.set('dailyLimit', limit);
}

// Extra allowance agreed for one day when the limit was reached.
export function getDailyExtra(): { date: string; amount: number } | undefined {
  return config.get('dailyExtra');
}

export function setDailyExtra(extra: { date: string; amount: number }): void {
  config.set('dailyExtra', extra);
}

// The last OpenRouter usage reading, kept between launches so "today" survives a restart.
export function getSpendReading(): SpendReading | undefined {
  return config.get('spendReading');
}

export function setSpendReading(reading: SpendReading): void {
  config.set('spendReading', reading);
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

// How Jeeves addresses the person (spec: asked once on first launch, changeable via /address).
export function getAddress(): string | null {
  return config.get('address') ?? null;
}

export function setAddress(address: string): void {
  config.set('address', address);
}

export function clearAddress(): void {
  config.delete('address');
}
// The trimmed models.dev catalogue for direct connections (prices and abilities).
export function getDirectCatalogue(): { catalogue: unknown; fetchedAt: number } | null {
  return config.get('directCatalogue') ?? null;
}

export function setDirectCatalogue(catalogue: unknown, fetchedAt: number): void {
  config.set('directCatalogue', { catalogue, fetchedAt });
}

// The address of the "any compatible service" the person added (its key is in the keychain).
export function getCustomService(): { baseURL: string } | null {
  return config.get('customService') ?? null;
}

export function setCustomService(service: { baseURL: string } | null): void {
  if (service) config.set('customService', service);
  else config.delete('customService');
}

// Today's spending worked out from price lists (direct connections), kept between
// launches so the daily limit still holds after a restart. OpenRouter's own
// figures are read from OpenRouter instead.
export function getEstimatedSpend(): { date: string; amount: number } | undefined {
  return config.get('estimatedSpend');
}

export function setEstimatedSpend(spend: { date: string; amount: number }): void {
  config.set('estimatedSpend', spend);
}

// Project folders where the person chose "always allow": changes inside them need no
// yes/no (they are still backed up, so /undo works). /ask removes a folder again.
export function getTrustedProjects(): string[] {
  return config.get('trustedProjects') ?? [];
}

export function setTrustedProjects(folders: string[]): void {
  config.set('trustedProjects', folders);
}
