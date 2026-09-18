import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { inputLayout, splitTypedBurst, cleanPaste } from '../src/components/input-layout.js';
import { inputRowsFor, MAX_INPUT_ROWS } from '../src/components/Input.js';
import { requestApproval, answerApproval, currentApprovalTrustable, hasPendingApproval } from '../src/agent/permissions.js';
import { isProjectTrusted, trustProject, untrustProject } from '../src/agent/trust.js';
import { session } from '../src/state/session.js';

describe('typing box: long messages wrap instead of scrolling off the left', () => {
  it('wraps at word boundaries and keeps every word visible', () => {
    const layout = inputLayout('the quick brown fox jumps over the lazy dog', 16);
    expect(layout.rows.map((row) => row.text)).toEqual(['the quick brown', 'fox jumps over', 'the lazy dog']);
    expect(layout.cursorX).toBe('the lazy dog'.length);
  });

  it('breaks a word longer than the row', () => {
    expect(inputLayout('abcdefghijklmnopqrstuvwxyz', 11).rows.map((row) => row.text)).toEqual(['abcdefghij', 'klmnopqrst', 'uvwxyz']);
  });

  it('after six rows the oldest scroll away, so the end of the message always shows', () => {
    const long = Array.from({ length: 40 }, (_, i) => `word${i}`).join(' ');
    const layout = inputLayout(long, 20);
    expect(layout.rows.length).toBe(MAX_INPUT_ROWS);
    expect(layout.rows[MAX_INPUT_ROWS - 1].text.endsWith('word39')).toBe(true);
  });

  it('every keystroke changes what is drawn, including a space at the edge', () => {
    let previous = JSON.stringify(inputLayout('', 12));
    let value = '';
    for (const ch of 'hello there my friend how are you') {
      value += ch;
      const next = JSON.stringify(inputLayout(value, 12));
      expect(next, JSON.stringify(value)).not.toBe(previous);
      previous = next;
    }
  });

  it('pasted line breaks start new rows', () => {
    expect(inputLayout('first line\nsecond', 40).rows.map((row) => row.text)).toEqual(['first line', 'second']);
  });

  it('the window gives the box as many rows as the text needs, one when empty', () => {
    expect(inputRowsFor('', 40)).toBe(1);
    expect(inputRowsFor('short', 40)).toBe(1);
    expect(inputRowsFor('x '.repeat(60), 40)).toBe(4);
  });
});

describe('typing box: Enter that arrives with the typing', () => {
  it('treats a burst ending in a line break as typing plus Enter (measured 18 Sept)', () => {
    expect(splitTypedBurst('Sorry that was my mistake\r')).toEqual({ typed: 'Sorry that was my mistake', enter: true, rest: '' });
    expect(splitTypedBurst('abc')).toEqual({ typed: 'abc', enter: false, rest: '' });
    expect(splitTypedBurst('one\r\ntwo')).toEqual({ typed: 'one', enter: true, rest: 'two' });
  });

  it('pastes keep their line breaks as plain newlines', () => {
    expect(cleanPaste('a\r\nb\rc\td')).toBe('a\nb\nc  d');
  });
});

describe('"always allow in this project"', () => {
  let dir: string;
  const cwd = process.cwd();
  beforeEach(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'jeeves-trust-'));
    process.chdir(dir);
  });
  afterEach(async () => {
    untrustProject();
    process.chdir(cwd);
    await rm(dir, { recursive: true, force: true });
  });

  it('is offered only for changes inside the project folder', async () => {
    const inside = requestApproval({ trustable: true });
    expect(currentApprovalTrustable()).toBe(true);
    answerApproval(true);
    await inside;
    const spending = requestApproval();
    expect(currentApprovalTrustable()).toBe(false);
    answerApproval(false);
    expect(await spending).toBe(false);
  });

  it('approves this change and the others waiting, remembers the folder, and /ask undoes it', async () => {
    const first = requestApproval({ trustable: true });
    const second = requestApproval({ trustable: true });
    const outside = requestApproval({ trustable: false });
    answerApproval(true, true);
    expect(await first).toBe(true);
    expect(await second).toBe(true);
    expect(isProjectTrusted()).toBe(true);
    // Something outside the folder is still asked about.
    expect(hasPendingApproval()).toBe(true);
    expect(currentApprovalTrustable()).toBe(false);
    answerApproval(false);
    expect(await outside).toBe(false);
    expect(untrustProject()).toBe(true);
    expect(isProjectTrusted()).toBe(false);
  });

  it('"always" cannot be used to answer a question that is not about the project folder', async () => {
    const spending = requestApproval();
    answerApproval(true, true);
    expect(await spending).toBe(true);
    expect(isProjectTrusted()).toBe(false);
  });

  it('once trusted, a change inside the folder is not asked about', async () => {
    trustProject();
    const { TOOLS } = await import('../src/tools/index.js');
    const before = session.transcript.length;
    await TOOLS.writeFile.execute!({ path: 'notes.txt', content: 'hi' }, { toolCallId: 't', messages: [] } as never);
    expect(session.transcript.slice(before).some((entry) => entry.kind === 'tool' && entry.data.state === 'awaiting')).toBe(false);
  });
});

describe('messages sent while Jeeves is busy', () => {
  it('wait in order and are taken one at a time', () => {
    session.queueMessage('first');
    session.queueMessage('second');
    expect(session.takeQueued()).toBe('first');
    expect(session.takeQueued()).toBe('second');
    expect(session.takeQueued()).toBeUndefined();
  });
});
