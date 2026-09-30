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
  | { type: 'ai' }
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
  openrouter: 'API key, pay as you go',
  zai: 'plan key, flat monthly',
  anthropic: 'API key only',
  openai: 'ChatGPT Plus/Pro plan or API key',
  google: 'API key',
  xai: 'API key',
  groq: 'API key',
  mistral: 'API key',
  custom: 'address + key',
  ollama: 'no key',
};

export function settingsRows(ctx: SettingsContext): SettingsRow[] {
  const rows: SettingsRow[] = [];
  const section = (title: string) => {
    if (rows.length > 0) rows.push({ kind: 'gap' });
    rows.push({ kind: 'header', title });
  };
  const item = (label: string, hint: string, action: SettingsAction, current = false) =>
    rows.push({ kind: 'item', label, hint, action, current });

  // First, where it is seen without scrolling: carrying on an earlier chat, or starting fresh.
  section('CONVERSATION');
  item('Earlier conversations →', 'carry on where you stopped', { type: 'chats' });
  item('What I remember →', 'the notes I keep about you and this folder', { type: 'memory' });
  for (const entry of COMMANDS) {
    if (entry.place === 'conversation') item(entry.label ?? entry.command, entry.description, { type: 'command', command: entry.command });
  }
  item('Go back to an earlier point →', 'put the folder back to before one of my changes', { type: 'rewind' });

  // The AI and the folder are each ONE row that opens the full list - every company, then its models,
  // then how to connect (the model list), and every folder (the folder list) - as OpenCode keeps a
  // provider list and a model list of their own. They were listed here in full (about forty rows) and
  // buried everything below them; the lists themselves are unchanged.
  section('AI AND FOLDER');
  const inUse = ctx.models.find((model) => model.id === ctx.model);
  const modelName = ctx.model === AUTO_MODEL_ID ? 'Auto' : inUse ? cleanModelName(inUse.name) : ctx.model;
  item('AI provider and model →', `now ${ctx.providerLabel} - ${modelName}`, { type: 'ai' });
  item('Project folder →', ctx.folder === ctx.chatFolder ? 'now just chatting' : `now ${ctx.folderName(ctx.folder)}`, { type: 'folders' });

  section('KEYS & SPENDING');
  item("What I've spent →", 'today, this week and what is left', { type: 'spending' });
  item('Manage keys', 'connect an AI service, or remove one', { type: 'command', command: '/keys' });
  item('Daily spending limit', 'the most Jeeves may spend in a day', { type: 'limit' });
  item('Weekly spending limit', 'the most Jeeves may spend in a week', { type: 'limit-weekly' });

  section('YOU');
  item('How I address you', "Sir, Ma'am, or a name", { type: 'command', command: '/address' });

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
