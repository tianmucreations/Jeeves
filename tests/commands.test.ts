import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { session } from '../src/state/session.js';
import { runTurn } from '../src/agent/loop.js';
import { clearConversation } from '../src/commands/clear.js';

describe('command dispatch', () => {
  beforeEach(() => {
    session.clearTranscript();
    session.setHistory([]);
    session.helpOpen = false;
    session.pickerOpen = false;
    session.keysOpen = false;
    session.exitRequested = false;
    session.setVerbose(false);
  });

  afterEach(() => {
    session.helpOpen = false;
    session.pickerOpen = false;
    session.keysOpen = false;
    session.exitRequested = false;
    session.clearTranscript();
    session.setHistory([]);
    session.setVerbose(false);
  });

  it('/help opens the help screen', async () => {
    await runTurn('/help');
    expect(session.helpOpen).toBe(true);
  });

  it('/model opens the picker', async () => {
    await runTurn('/model');
    expect(session.pickerOpen).toBe(true);
  });

  it('/keys opens the key screens', async () => {
    await runTurn('/keys');
    expect(session.keysOpen).toBe(true);
  });

  it('/clear wipes the transcript and the conversation', async () => {
    session.addUser('old message');
    session.setHistory([{ role: 'user', content: 'old message' }]);
    await runTurn('/clear');
    // Only the note that says so is left (audit, 19 Sept: it used to clear in silence).
    expect(session.transcript.map((entry) => entry.kind)).toEqual(['notice']);
    expect(session.transcript[0]).toMatchObject({ text: 'Started a fresh conversation - the earlier one stays saved.' });
    expect(session.history).toHaveLength(0);
  });

  it('/exit requests a clean shutdown', async () => {
    await runTurn('/exit');
    expect(session.exitRequested).toBe(true);
  });

  it('/verbose toggles and mentions the state', async () => {
    await runTurn('/verbose');
    expect(session.verbose).toBe(true);
    expect(session.transcript.some((entry) => entry.kind === 'notice' && entry.text.includes('on'))).toBe(true);
  });

  it('unknown commands point at Settings', async () => {
    await runTurn('/bogus');
    expect(session.transcript.some((entry) => entry.kind === 'notice' && entry.text.includes('Settings'))).toBe(true);
  });

  it('clearConversation works directly', () => {
    session.addUser('hello');
    session.addNotice('note');
    clearConversation();
    expect(session.transcript).toHaveLength(0);
  });
});
import { COMMAND_TABLE } from '../src/commands/registry.js';
import { COMMANDS } from '../src/commands/help.js';
import { settingsRows } from '../src/commands/settings.js';

describe('one table of commands (Claude Code / OpenCode keep a registry)', () => {
  it('every command is written once: Help, Settings and the typed commands all come from it', () => {
    expect(COMMANDS.map((c) => c.command)).toEqual(COMMAND_TABLE.map((c) => c.command));
    expect(new Set(COMMAND_TABLE.map((c) => c.command)).size).toBe(COMMAND_TABLE.length);
    const base = { folder: '/x', chatFolder: '/x', recentProjects: [], providerId: 'zai', providerLabel: 'Z.ai', model: 'm', models: [], favorites: [], recents: [], services: [], connected: () => false, folderName: (f: string) => f, folderPath: (f: string) => f };
    const listed = settingsRows(base as never).flatMap((row) => (row.kind === 'item' && row.action.type === 'command' ? [row.action.command] : []));
    // Every command marked for Settings has its button, and nothing else is invented there.
    expect(listed.filter((c) => c !== '/keys' && c !== '/address').sort()).toEqual(COMMAND_TABLE.filter((c) => c.place).map((c) => c.command).sort());
  });
  it('a command that is not in the table is answered plainly, and a plain message is not a command', async () => {
    session.clearTranscript();
    await runTurn('/nonsense');
    expect(session.transcript.some((e) => e.kind === 'notice' && e.text.includes('click Settings'))).toBe(true);
  });
});
