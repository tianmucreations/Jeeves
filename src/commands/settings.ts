import { COMMANDS } from './help.js';
import { cleanModelName, compactPrice, resolveCurated, type ModelInfo } from '../models/registry.js';
import { isToolCapable } from '../models/filter.js';
import { isModelUnreliable } from '../agent/model-health.js';

// One screen with everything in it, every choice listed out (owner, 23 Sept: "all
// the folders including browse and new project... the providers, same thing, then
// models and so on, command information down last"), in sections with a blank line
// between them. Choosing a row does the thing directly where it can (a folder, a
// model), and otherwise opens the real screen for it at the right place - so no
// screen's own logic is duplicated here.
export type SettingsAction =
  | { type: 'command'; command: string }
  | { type: 'chat' }
  | { type: 'folder'; folder: string }
  | { type: 'browse' }
  | { type: 'create' }
  | { type: 'service'; provider: string }
  | { type: 'model'; provider: string; model: ModelInfo }
  | { type: 'all-models'; provider: string }
  | { type: 'limit' };

export type SettingsRow =
  | { kind: 'gap' }
  | { kind: 'header'; title: string }
  | { kind: 'item'; label: string; hint: string; current?: boolean; action: SettingsAction };

export interface SettingsContext {
  folder: string;
  chatFolder: string;
  recentProjects: string[];
  providerId: string;
  providerLabel: string;
  model: string;
  // The models of the service in use, where they are known without asking it (OpenRouter's list, Z.ai's).
  models: ModelInfo[];
  favorites: string[];
  recents: string[];
  services: { id: string; label: string; description: string }[];
  connected: (serviceId: string) => boolean;
  folderName: (folder: string) => string;
  folderPath: (folder: string) => string;
}

export function settingsRows(ctx: SettingsContext): SettingsRow[] {
  const rows: SettingsRow[] = [];
  const section = (title: string) => {
    if (rows.length > 0) rows.push({ kind: 'gap' });
    rows.push({ kind: 'header', title });
  };
  const item = (label: string, hint: string, action: SettingsAction, current = false) =>
    rows.push({ kind: 'item', label, hint, action, current });

  section('FOLDERS');
  item('Just chat', 'no project needed', { type: 'chat' }, ctx.folder === ctx.chatFolder);
  for (const folder of ctx.recentProjects) {
    item(ctx.folderName(folder), ctx.folderPath(folder), { type: 'folder', folder }, folder === ctx.folder);
  }
  item('Browse for a folder →', '', { type: 'browse' });
  item('Create a new project →', '', { type: 'create' });

  section('AI PLAN');
  for (const service of ctx.services) {
    const state = service.id === ctx.providerId ? 'in use' : ctx.connected(service.id) ? 'connected' : '';
    item(service.label, state ? `${state} - ${service.description}` : service.description, { type: 'service', provider: service.id }, service.id === ctx.providerId);
  }

  section(`MODELS - ${ctx.providerLabel} (in use - pick a plan above for others)`);
  // Only models that can do tasks, and not one that has just failed twice running:
  // Jeeves only offers what is proven to work.
  const usable = (model: ModelInfo) => isToolCapable(model) && !isModelUnreliable(model.id);
  const listed = new Set<string>();
  const add = (model: ModelInfo, hint: string) => {
    if (listed.has(model.id) || !usable(model)) return;
    listed.add(model.id);
    item(cleanModelName(model.name), hint, { type: 'model', provider: ctx.providerId, model }, model.id === ctx.model);
  };
  if (ctx.providerId === 'openrouter') {
    for (const pick of resolveCurated(ctx.models)) add(pick.model, pick.blurb);
  }
  const byId = new Map(ctx.models.map((model) => [model.id, model]));
  // The one in use, then favourites and recent ones, then (a short list like Z.ai's) the rest.
  for (const id of [ctx.model, ...ctx.favorites, ...ctx.recents]) {
    const model = byId.get(id);
    if (model) add(model, compactPrice(model.promptPrice, model.completionPrice, model.priceLabel));
  }
  if (ctx.providerId !== 'openrouter') {
    for (const model of ctx.models) add(model, compactPrice(model.promptPrice, model.completionPrice, model.priceLabel));
  }
  item(ctx.providerId === 'openrouter' ? 'All models →' : `Choose a ${ctx.providerLabel} model →`, ctx.providerId === 'openrouter' ? 'search every model, including free ones' : '', {
    type: 'all-models',
    provider: ctx.providerId,
  });

  section('KEYS & SPENDING');
  item('Manage keys', 'connect an AI service, or remove one', { type: 'command', command: '/keys' });
  item('Daily spending limit', 'the most Jeeves may spend in a day', { type: 'limit' });

  section('YOU');
  item('How I address you', "Sir, Ma'am, or a name", { type: 'command', command: '/address' });

  section('COMMANDS - type these any time, or choose one here');
  for (const entry of COMMANDS) {
    if (entry.command === '/settings') continue;
    item(entry.command, entry.description, { type: 'command', command: entry.command });
  }
  return rows;
}

export function selectableIndexes(rows: SettingsRow[]): number[] {
  return rows.flatMap((row, index) => (row.kind === 'item' ? [index] : []));
}
