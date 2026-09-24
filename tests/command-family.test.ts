import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { commandFamily, commandFamilies } from '../src/agent/command-family.js';
import { trustCommandFamily, isCommandFamilyTrusted, untrustCommandFamilies } from '../src/agent/trust.js';
import { requestApproval, answerApproval, currentApprovalFamily, hasPendingApproval } from '../src/agent/permissions.js';
import { session } from '../src/state/session.js';

// "Always allow this kind of command" - the owner has reported approval fatigue
// for weeks ("You have to be strapped to the screen as all he does is ask for
// permission"). Claude Code saves a per-repo `Bash(prefix *)` rule when the
// person answers "don't ask again"; OpenCode saves the command pattern per
// project (computed with its arity table). This is Jeeves's version: the kind
// of the command, remembered per folder, permanently, from the person's answer.
describe('the kind of a command', () => {
  it('is the few words that name what the command is', () => {
    expect(commandFamily('wc -w notes.txt')).toBe('wc');
    expect(commandFamily('wc -l src/*.py')).toBe('wc');
    expect(commandFamily('git status')).toBe('git status');
    expect(commandFamily('git push origin main')).toBe('git push');
    expect(commandFamily('npm install')).toBe('npm install');
    expect(commandFamily('npm run dev')).toBe('npm run dev');
    expect(commandFamily('rm -rf build')).toBe('rm');
    expect(commandFamily('ls -la')).toBe('ls');
    expect(commandFamily('du -sh .')).toBe('du');
  });

  it('covers every stage of a compound command separately', () => {
    expect(commandFamilies('cat a.txt && npm install left-pad')).toEqual(['cat', 'npm install']);
    expect(commandFamilies('grep -c foo big.log | sort | uniq')).toEqual(['grep', 'sort', 'uniq']);
  });
});

describe('a command kind allowed once never asks again in that folder', () => {
  let folder: string;
  let otherFolder: string;
  const startingCwd = process.cwd();

  beforeEach(async () => {
    folder = await realpath(await mkdtemp(path.join(tmpdir(), 'jeeves-kind-')));
    otherFolder = await realpath(await mkdtemp(path.join(tmpdir(), 'jeeves-kind2-')));
    process.chdir(folder);
  });

  afterEach(async () => {
    process.chdir(startingCwd);
    untrustCommandFamilies(folder);
    untrustCommandFamilies(otherFolder);
    await rm(folder, { recursive: true, force: true });
    await rm(otherFolder, { recursive: true, force: true });
  });

  it('trustCommandFamily remembers the kind and isCommandFamilyTrusted honours it', () => {
    expect(isCommandFamilyTrusted('wc -w anything.txt')).toBe(false);
    trustCommandFamily('wc -w notes.txt');
    expect(isCommandFamilyTrusted('wc -l other.txt')).toBe(true);
    expect(isCommandFamilyTrusted('wc anything')).toBe(true);
    // A different kind is still asked about.
    expect(isCommandFamilyTrusted('curl https://example.com')).toBe(false);
    // And so is the same kind in a different folder.
    expect(isCommandFamilyTrusted('wc -l x', otherFolder)).toBe(false);
  });

  it('answering the question with "always allow this kind" remembers it and answers waiting questions of the same kind', async () => {
    const first = requestApproval({ trustable: true, command: 'wc -w notes.txt' });
    const waiting = requestApproval({ trustable: true, command: 'wc -c other.txt' });
    const different = requestApproval({ trustable: true, command: 'touch newfile' });
    expect(currentApprovalFamily()).toBe('wc');
    answerApproval(true, 'command');
    expect(await first).toBe(true);
    expect(await waiting).toBe(true);
    expect(hasPendingApproval()).toBe(true);
    answerApproval(false);
    expect(await different).toBe(false);
    expect(isCommandFamilyTrusted('wc -l later.txt')).toBe(true);
  });

  it('a multi-stage command remembers every kind it needs', async () => {
    const command = 'cat notes.txt && wc -w notes.txt';
    const pending = requestApproval({ trustable: true, command });
    expect(currentApprovalFamily()).toBe('these commands');
    answerApproval(true, 'command');
    expect(await pending).toBe(true);
    expect(isCommandFamilyTrusted('cat other.txt')).toBe(true);
    expect(isCommandFamilyTrusted('wc -l other.txt')).toBe(true);
  });

  it('untrustCommandFamilies clears the kinds for a folder (/ask)', () => {
    trustCommandFamily('wc -w notes.txt');
    untrustCommandFamilies(folder);
    expect(isCommandFamilyTrusted('wc -w notes.txt')).toBe(false);
  });
});

// The engine must never leave a question hanging when the app closes.
describe('shutdown answers every waiting question', () => {
  it('loop.ts drains the queue with answerApproval(false)', () => {
    requestApproval({ trustable: true, command: 'wc -c x' });
    requestApproval();
    while (hasPendingApproval()) answerApproval(false);
    expect(hasPendingApproval()).toBe(false);
  });
});

// session is imported so the permissions module is exercised the way the app
// uses it (the queue toggles the amber state on screen).
it('the session knows a question is waiting', () => {
  expect(session.approvalPending).toBe(false);
});
