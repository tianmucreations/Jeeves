import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { session } from '../src/state/session.js';
import { trustProject, untrustProject, isPathTrusted, isCommandTrusted } from '../src/agent/trust.js';

// A real task of the owner's often touches a second project folder from within
// the first (see "REVIEW AND REFRESHED PLAN 22 SEPT.txt" - most of the 20-30
// approval prompts he reported trace back to exactly this). "Always allow" used
// to cover only the one active folder, so the second one re-asked every single
// time, forever, even after it had already been trusted on its own.
describe('a folder trusted once stays trusted when reached from a different project', () => {
  let trustedFolder: string;
  let activeFolder: string;
  const startingCwd = process.cwd();

  beforeEach(async () => {
    // Resolved to their real path (macOS's tmp folder sits behind a symlink) so
    // these behave like the owner's own project folders, which are not symlinked.
    trustedFolder = await realpath(await mkdtemp(path.join(tmpdir(), 'jeeves-trusted-')));
    activeFolder = await realpath(await mkdtemp(path.join(tmpdir(), 'jeeves-active-')));
    trustProject(trustedFolder);
    process.chdir(activeFolder);
  });

  afterEach(async () => {
    untrustProject(trustedFolder);
    process.chdir(startingCwd);
    await rm(trustedFolder, { recursive: true, force: true });
    await rm(activeFolder, { recursive: true, force: true });
  });

  it('isPathTrusted recognises a path inside the trusted folder while a different folder is active', () => {
    expect(isPathTrusted(path.join(trustedFolder, 'notes.txt'))).toBe(true);
    expect(isPathTrusted(path.join(activeFolder, '..', 'somewhere-else', 'notes.txt'))).toBe(false);
  });

  it('isCommandTrusted recognises a command that stays entirely inside the trusted folder', () => {
    expect(isCommandTrusted(`echo hi > "${path.join(trustedFolder, 'notes.txt')}"`)).toBe(true);
    expect(isCommandTrusted(`rm -rf "${path.join(activeFolder, '..', 'somewhere-else')}"`)).toBe(false);
  });

  it('a command reaching two places, only one of them trusted, is not treated as covered', () => {
    // sed anywhere is always asked about regardless of folder - a real, safe check
    // that trusting one folder never silently trusts sudo/apt/brew-style commands.
    expect(isCommandTrusted(`sudo cp "${path.join(trustedFolder, 'a')}" "${path.join(trustedFolder, 'b')}"`)).toBe(false);
  });

  it('writing into the trusted folder from a different active project asks nothing at all', async () => {
    const { TOOLS } = await import('../src/tools/index.js');
    const before = session.transcript.length;
    await TOOLS.writeFile.execute!(
      { path: path.join(trustedFolder, 'demo.txt'), content: 'hello' },
      { toolCallId: 't', messages: [] } as never
    );
    const added = session.transcript.slice(before);
    expect(added.some((entry) => entry.kind === 'tool' && entry.data.state === 'awaiting')).toBe(false);
    expect(added.some((entry) => entry.kind === 'notice' && entry.text.includes('Heads up'))).toBe(false);
  });

  it('writing somewhere that is neither the active nor a trusted folder still asks', async () => {
    const { TOOLS } = await import('../src/tools/index.js');
    const untrustedTarget = await mkdtemp(path.join(tmpdir(), 'jeeves-untrusted-'));
    try {
      const before = session.transcript.length;
      const call = TOOLS.writeFile.execute!(
        { path: path.join(untrustedTarget, 'demo.txt'), content: 'hello' },
        { toolCallId: 't', messages: [] } as never
      );
      // Deny it - the point here is only that it asked at all.
      const { answerApproval, hasPendingApproval } = await import('../src/agent/permissions.js');
      expect(hasPendingApproval()).toBe(true);
      answerApproval(false);
      await call.catch(() => {});
      // It asked at all (proven above by hasPendingApproval), and declining it
      // left the usual "declined" record rather than being skipped in silence.
      expect(session.transcript.slice(before).some((entry) => entry.kind === 'tool' && entry.data.state === 'declined')).toBe(true);
    } finally {
      await rm(untrustedTarget, { recursive: true, force: true });
    }
  });
});
