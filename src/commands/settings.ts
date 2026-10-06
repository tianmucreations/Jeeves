import { COMMANDS } from './help.js';
import { cleanModelName, type ModelInfo } from '../models/registry.js';
import { isToolCapable } from '../models/filter.js';
import { isModelUnreliable } from '../agent/model-health.js';
import { AUTO_MODEL_ID } from '../agent/auto-ids.js';
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
  | { type: 'more-providers' }
  | { type: 'providers' }
  | { type: 'folders' }
  | { type: 'chats' }
  | { type: 'memory' }
  | { type: 'rewind' }
  | { type: 'spending' }
  | { type: 'limit' }
  | { type: 'limit-weekly' };

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

// How each service connects, in plain words (OpenCode's "(API key)" tags): a key you
// paste in that is billed by use, or a flat monthly plan's key. Signing in with a
// ChatGPT or Copilot subscription is not offered yet.
export const HOW_IT_CONNECTS: Record<string, string> = {
  openrouter: 'Pay per use, with a key (400+ models)',
  zai: 'Flat monthly plan (GLM Coding Plan)',
  anthropic: "Key only - Anthropic doesn't allow Claude plans in other apps",
  openai: 'ChatGPT plan, or a key',
  google: 'Pay per use, with a key',
  xai: 'Pay per use, with a key',
  groq: 'Pay per use, with a key',
  mistral: 'Pay per use, with a key',
  custom: 'Any other provider - its address and a key',
  ollama: 'Free, runs on this computer',
};

export function settingsRows(ctx: SettingsContext): SettingsRow[] {
  const rows: SettingsRow[] = [];
  const section = (title: string) => {
    if (rows.length > 0) rows.push({ kind: 'gap' });
    rows.push({ kind: 'header', title });
  };
  const item = (label: string, hint: string, action: SettingsAction, current = false) =>
    rows.push({ kind: 'item', label, hint, action, current });

  // The order of the three choices Jeeves needs, as the owner laid it out (30 Sept): 1 the folder to work
  // in, 2 the provider, 3 the model (and how to connect: a plan or a key). Each is one row, showing what
  // is chosen now, that opens the full list for that step.
  section('CHOOSE');
  const inUse = ctx.models.find((model) => model.id === ctx.model);
  const modelName = ctx.model === AUTO_MODEL_ID ? 'Auto' : inUse ? cleanModelName(inUse.name) : ctx.model;
  item('1. Project folder →', ctx.folder === ctx.chatFolder ? 'now just chatting' : `now ${ctx.folderName(ctx.folder)}`, { type: 'folders' });
  item('2. Provider →', `now ${ctx.providerLabel}${ctx.providerId === 'chatgpt' ? ' (your plan)' : ''}`, { type: 'providers' });
  item('3. Model →', `now ${modelName} - and how to connect`, { type: 'service', provider: ctx.providerId === 'chatgpt' ? 'openai' : ctx.providerId });

  section('SPENDING');
  item("What I've spent →", 'today, this week and what is left', { type: 'spending' });
  item('Daily spending limit', 'the most Jeeves may spend in a day', { type: 'limit' });
  item('Weekly spending limit', 'the most Jeeves may spend in a week', { type: 'limit-weekly' });

  section('YOU');
  item('How I address you', "Sir, Ma'am, or a name", { type: 'command', command: '/address' });
  item('What I remember →', 'the notes I keep about you and this folder', { type: 'memory' });

  section('CONVERSATIONS');
  item('Earlier conversations →', 'carry on where you stopped', { type: 'chats' });
  for (const entry of COMMANDS) {
    if (entry.place === 'conversation') item(entry.label ?? entry.command, entry.description, { type: 'command', command: entry.command });
  }
  item('Go back to an earlier point →', 'put the folder back to before one of my changes', { type: 'rewind' });

  section('MORE');
  for (const entry of COMMANDS) {
    if (entry.place !== 'more') continue;
    item(entry.label ?? entry.command, entry.description, { type: 'command', command: entry.command });
  }
  return rows;
}

export function selectableIndexes(rows: SettingsRow[]): number[] {
  return rows.flatMap((row, index) => (row.kind === 'item' ? [index] : []));
}
