import { describe, it, expect } from 'vitest';
import { settingsRows, selectableIndexes, type SettingsContext, type SettingsRow } from '../src/commands/settings.js';
import { COMMANDS } from '../src/commands/help.js';
import { PROVIDER_ROWS } from '../src/providers/index.js';
import { ZAI_MODELS } from '../src/providers/zai.js';
import { AUTO_MODEL_ID } from '../src/agent/auto-ids.js';
import type { ModelInfo } from '../src/models/registry.js';
import { session } from '../src/state/session.js';
import { runTurn } from '../src/agent/loop.js';
import { handleMouseInput } from '../src/ink/mouse.js';
import { onSettingsButton } from '../src/components/Footer.js';

const model = (id: string, name: string, tools = true, price = 1): ModelInfo => ({
  id,
  name,
  contextLength: 200_000,
  promptPrice: price,
  completionPrice: price,
  supportedParameters: tools ? ['tools'] : [],
  provider: id.split('/')[0],
});

const openrouterModels = [
  model('z-ai/glm-5.3', 'Z.ai: GLM 5.3'),
  model('deepseek/deepseek-v4-flash-0731', 'DeepSeek: V4 Flash'),
  model('meta/chat-only', 'Meta: Chat Only', false),
  model('mistral/favourite', 'Mistral: Favourite'),
];

const base: SettingsContext = {
  folder: '/Users/x/Projects/Alpha',
  chatFolder: '/Users/x/Documents/Jeeves Chats',
  recentProjects: ['/Users/x/Projects/Alpha', '/Users/x/Projects/Beta'],
  providerId: 'openrouter',
  providerLabel: 'OpenRouter',
  model: AUTO_MODEL_ID,
  models: openrouterModels,
  favorites: ['mistral/favourite'],
  recents: [],
  services: PROVIDER_ROWS,
  connected: (id) => id === 'openrouter' || id === 'zai',
  folderName: (folder) => folder.split('/').pop() ?? folder,
  folderPath: (folder) => folder.replace('/Users/x', '~'),
};

const items = (rows: SettingsRow[]) => rows.filter((row): row is Extract<SettingsRow, { kind: 'item' }> => row.kind === 'item');
const headers = (rows: SettingsRow[]) => rows.filter((row) => row.kind === 'header').map((row) => (row as { title: string }).title);

describe('the Settings list - everything listed out (owner, 23 Sept)', () => {
  it('runs in order: folders, services, models, keys, you, and the commands last', () => {
    const titles = headers(settingsRows(base));
    expect(titles[0]).toBe('FOLDERS');
    expect(titles[1]).toBe('AI PLAN');
    expect(titles[2]).toMatch(/^MODELS/);
    expect(titles[titles.length - 1]).toMatch(/^COMMANDS/);
  });

  it('puts a blank line between sections, and never one at the very top', () => {
    const rows = settingsRows(base);
    expect(rows[0].kind).toBe('header');
    rows.forEach((row, index) => {
      if (row.kind === 'header' && index > 0) expect(rows[index - 1].kind).toBe('gap');
    });
  });

  it('lists every recent folder, Just chat, Browse and Create - the one in use ticked', () => {
    const folderRows = items(settingsRows(base)).filter((row) => ['chat', 'folder', 'browse', 'create'].includes(row.action.type));
    expect(folderRows.map((row) => row.label)).toEqual(['Just chat', 'Alpha', 'Beta', 'Browse for a folder →', 'Create a new project →']);
    expect(folderRows.filter((row) => row.current).map((row) => row.label)).toEqual(['Alpha']);
  });

  it('lists every AI service, saying which is in use and which are connected', () => {
    const services = items(settingsRows(base)).filter((row) => row.action.type === 'service');
    expect(services.map((row) => row.label)).toEqual(PROVIDER_ROWS.map((row) => row.label));
    expect(services.find((row) => row.label === 'OpenRouter')?.hint).toMatch(/^in use/);
    expect(services.find((row) => row.label === 'Z.ai')?.hint).toMatch(/^connected/);
    expect(services.find((row) => row.label === 'Anthropic')?.hint).not.toMatch(/connected|in use/);
  });

  it("lists the service's recommended models (Auto first, ticked) and favourites - never one that can't do tasks", () => {
    const models = items(settingsRows(base)).filter((row) => row.action.type === 'model');
    expect(models[0].label).toBe('Auto');
    expect(models[0].current).toBe(true);
    const labels = models.map((row) => row.label);
    expect(labels).toContain('GLM 5.3');
    expect(labels).toContain('Favourite');
    expect(labels).not.toContain('Chat Only');
    expect(items(settingsRows(base)).some((row) => row.action.type === 'all-models')).toBe(true);
  });

  it("on Z.ai, lists Z.ai's own models", () => {
    const rows = settingsRows({ ...base, providerId: 'zai', providerLabel: 'Z.ai', model: 'glm-5.3', models: ZAI_MODELS });
    const models = items(rows).filter((row) => row.action.type === 'model');
    expect(models.length).toBe(ZAI_MODELS.filter((m) => m.supportedParameters.includes('tools')).length);
    expect(models.find((row) => row.current)?.label).toBe('GLM-5.3');
  });

  it('offers both spending limits next to the keys', () => {
    const spending = items(settingsRows(base)).filter((row) => row.action.type === 'limit' || row.action.type === 'limit-weekly');
    expect(spending.map((row) => row.label)).toEqual(['Daily spending limit', 'Weekly spending limit']);
  });

  it('ends with every command except /settings itself', () => {
    const commands = items(settingsRows(base)).filter((row) => row.action.type === 'command' && row.label.startsWith('/'));
    expect(commands.map((row) => row.label)).toEqual(COMMANDS.map((entry) => entry.command).filter((c) => c !== '/settings'));
  });

  it('only rows that do something can be highlighted', () => {
    const rows = settingsRows(base);
    for (const index of selectableIndexes(rows)) expect(rows[index].kind).toBe('item');
  });
});

describe('opening the Settings screen', () => {
  it('/settings opens it, matching every other screen-opening command', async () => {
    session.closeSettings();
    await runTurn('/settings');
    expect(session.settingsOpen).toBe(true);
    session.closeSettings();
  });

  it('the Settings button in the info bar is a real click target, its cap on the border line', () => {
    expect(onSettingsButton(1)).toBe(true);
    expect(onSettingsButton(11)).toBe(true);
    expect(onSettingsButton(12)).toBe(false);
    session.closeSettings();
    const opened: [number, number][] = [];
    session.footerClick = (col, row) => {
      opened.push([col, row]);
      return true;
    };
    session.transcriptView = null;
    handleMouseInput('\x1b[<0;3;24M');
    expect(opened).toEqual([[3, 24]]);
    session.footerClick = null;
  });
});

describe('the wheel over the typing box', () => {
  it('reads back through a long message instead of scrolling the conversation', () => {
    session.transcriptScrollUp = 0;
    session.transcriptView = null;
    const wheeled: boolean[] = [];
    session.inputWheel = (_row, up) => {
      wheeled.push(up);
      return true;
    };
    handleMouseInput('\x1b[<64;5;21M');
    handleMouseInput('\x1b[<65;5;21M');
    expect(wheeled).toEqual([true, false]);
    expect(session.transcriptScrollUp).toBe(0);
    // Not over the box (or nothing to read back): the conversation scrolls as before.
    session.inputWheel = () => false;
    handleMouseInput('\x1b[<64;5;5M');
    expect(session.transcriptScrollUp).toBe(3);
    session.inputWheel = null;
    session.transcriptScrollUp = 0;
  });
});
