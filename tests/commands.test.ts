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
    expect(session.transcript).toHaveLength(0);
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

  it('unknown commands point at /help', async () => {
    await runTurn('/bogus');
    expect(session.transcript.some((entry) => entry.kind === 'notice' && entry.text.includes('/help'))).toBe(true);
  });

  it('clearConversation works directly', () => {
    session.addUser('hello');
    session.addNotice('note');
    clearConversation();
    expect(session.transcript).toHaveLength(0);
  });
});