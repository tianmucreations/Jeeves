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
  it('runs in the owner\'s order (30 Sept): the three choices first - 1 folder, 2 provider, 3 model - then spending, you, conversations, more', () => {
    const titles = headers(settingsRows(base));
    expect(titles).toEqual(['CHOOSE', 'SPENDING', 'YOU', 'CONVERSATIONS', 'MORE']);
    const steps = items(settingsRows(base)).slice(0, 3).map((row) => row.label);
    expect(steps).toEqual(['1. Project folder →', '2. Provider →', '3. Model →']);
  });

  it('has no separate keys list: connecting and disconnecting are part of choosing the provider and model', () => {
    const labels = items(settingsRows(base)).map((row) => row.label);
    expect(labels.some((label) => /keys/i.test(label))).toBe(false);
    expect(items(settingsRows(base)).some((row) => row.action.type === 'command' && row.action.command === '/keys')).toBe(false);
  });

  it('is short enough to see nearly all of it in one window (the long lists were burying the buttons)', () => {
    expect(settingsRows(base).length).toBeLessThan(34);
  });

  it('puts a blank line between sections, and never one at the very top', () => {
    const rows = settingsRows(base);
    expect(rows[0].kind).toBe('header');
    rows.forEach((row, index) => {
      if (row.kind === 'header' && index > 0) expect(rows[index - 1].kind).toBe('gap');
    });
  });

  it('step 2 says which provider is in use now, and step 3 which model, each opening its own list', () => {
    const rows = items(settingsRows(base));
    const provider = rows.find((r) => r.label === '2. Provider →')!;
    const model = rows.find((r) => r.label === '3. Model →')!;
    expect(provider.hint).toBe('now OpenRouter');
    expect(provider.action.type).toBe('providers');
    expect(model.hint).toBe('now Auto - and how to connect');
    expect(model.action).toEqual({ type: 'service', provider: 'openrouter' });
    const onZai = items(settingsRows({ ...base, providerId: 'zai', providerLabel: 'Z.ai', model: 'glm-5.3', models: ZAI_MODELS }));
    expect(onZai.find((r) => r.label === '2. Provider →')!.hint).toBe('now Z.ai');
    expect(onZai.find((r) => r.label === '3. Model →')!.hint).toBe('now GLM-5.3 - and how to connect');
    const onChatGpt = items(settingsRows({ ...base, providerId: 'chatgpt', providerLabel: 'ChatGPT', model: 'gpt-5.5', models: [] }));
    expect(onChatGpt.find((r) => r.label === '2. Provider →')!.hint).toBe('now ChatGPT (your plan)');
    expect(onChatGpt.find((r) => r.label === '3. Model →')!.action).toEqual({ type: 'service', provider: 'openai' });
  });

  it('step 1 says where Jeeves is working, and opens the folder list', () => {
    const row = items(settingsRows(base)).find((r) => r.action.type === 'folders')!;
    expect(row.label).toBe('1. Project folder →');
    expect(row.hint).toBe('now Alpha');
    const chatting = items(settingsRows({ ...base, folder: base.chatFolder })).find((r) => r.action.type === 'folders')!;
    expect(chatting.hint).toBe('now just chatting');
  });

  it("keeps a way to every service's own list: the picker the row opens lists them all", () => {
    expect(PROVIDER_ROWS.length).toBeGreaterThan(5);
  });

  it('spending has its own section: what I have spent, and both limits', () => {
    const rows = settingsRows(base);
    const at = rows.findIndex((row) => row.kind === 'header' && row.title === 'SPENDING');
    const spending = items(rows.slice(at, at + 5)).map((row) => row.label);
    expect(spending).toEqual(["What I've spent →", 'Daily spending limit', 'Weekly spending limit']);
  });

  it('lists every command that the one table marks for Settings, in the table\'s order (conversation ones first, then More)', () => {
    const commands = items(settingsRows(base)).filter((row) => row.action.type === 'command' && row.action.command !== '/keys' && row.action.command !== '/address');
    const expected = [...COMMANDS.filter((entry) => entry.place === 'conversation'), ...COMMANDS.filter((entry) => entry.place === 'more')].map((entry) => entry.label);
    expect(commands.map((row) => row.label)).toEqual(expected);
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

  it('the Settings button in the info bar is a real click target, inside the border wall (layout A)', () => {
    expect(onSettingsButton(1)).toBe(false);
    expect(onSettingsButton(2)).toBe(true);
    expect(onSettingsButton(11)).toBe(true);
    expect(onSettingsButton(12)).toBe(false);
    session.closeSettings();
    const opened: [number, number][] = [];
    session.footerClick = (col, row) => {
      opened.push([col, row]);
      return true;
    };
    session.transcriptView = null;
    // A real click still reaches the handler with its exact column and row
    // (which row is the bar is the live Footer's job - layout A: the row above
    // the bottom border).
    handleMouseInput('\x1b[<0;3;23M');
    expect(opened).toEqual([[3, 23]]);
    session.footerClick = null;
  });
});

describe('the wheel over the typing box', () => {
  it('reaches the box wherever mouse reporting is live; the conversation itself scrolls natively now', () => {
    session.transcriptView = null;
    const wheeled: [number, boolean][] = [];
    session.inputWheel = (row, up) => {
      wheeled.push([row, up]);
    };
    handleMouseInput('\x1b[<64;5;21M');
    handleMouseInput('\x1b[<65;5;21M');
    expect(wheeled).toEqual([[21, true], [21, false]]);
    // With no box listener, a wheel event is simply nobody's: the terminal
    // scrolls itself in the plain conversation (there is no in-app scrolling
    // to fall back to any more - that machinery is retired).
    session.inputWheel = () => {};
    handleMouseInput('\x1b[<64;5;5M');
    session.inputWheel = null;
  });
});
