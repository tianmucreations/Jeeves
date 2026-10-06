import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { editRefusal, runEditFile, editedContent } from '../src/tools/editFile.js';
import { runReadFile } from '../src/tools/readFile.js';
import { resetSeenFiles } from '../src/tools/write-safety.js';

// Claude Code's Edit tool and OpenCode's edit tool: change one exact piece of a file.
let dir = '';
let file = '';
beforeEach(async () => {
  resetSeenFiles();
  dir = await mkdtemp(path.join(tmpdir(), 'jeeves-edit-'));
  file = path.join(dir, 'notes.txt');
  await writeFile(file, 'alpha\nbeta\ngamma\nbeta\n', 'utf8');
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe('editFile', () => {
  it('changes only the named piece, after the file has been read', async () => {
    await runReadFile({ path: file } as never);
    const input = { path: file, oldText: 'gamma', newText: 'delta' };
    expect(await editRefusal(input)).toBeNull();
    expect(await runEditFile(input)).toContain('1 place');
    expect(await readFile(file, 'utf8')).toBe('alpha\nbeta\ndelta\nbeta\n');
  });
  it('refuses a file nobody has read, or one changed since', async () => {
    const input = { path: file, oldText: 'gamma', newText: 'delta' };
    expect(await editRefusal(input)).toContain("hasn't been read yet");
    await runReadFile({ path: file } as never);
    await new Promise((r) => setTimeout(r, 20));
    await writeFile(file, 'changed by hand gamma\n', 'utf8');
    expect(await editRefusal(input)).toContain('changed since it was last read');
  });
  it('refuses text that is missing, or matches more than once, unless replaceAll', async () => {
    await runReadFile({ path: file } as never);
    expect(await editRefusal({ path: file, oldText: 'zeta', newText: 'x' })).toContain("isn't in the file");
    expect(await editRefusal({ path: file, oldText: 'beta', newText: 'x' })).toContain('2 times');
    expect(await editRefusal({ path: file, oldText: 'beta', newText: 'x', replaceAll: true })).toBeNull();
    expect(await runEditFile({ path: file, oldText: 'beta', newText: 'x', replaceAll: true })).toContain('2 places');
    expect(await readFile(file, 'utf8')).toBe('alpha\nx\ngamma\nx\n');
  });
  it('refuses a missing file, an empty search and a change to nothing', async () => {
    expect(await editRefusal({ path: path.join(dir, 'no.txt'), oldText: 'a', newText: 'b' })).toContain('use writeFile');
    await runReadFile({ path: file } as never);
    expect(await editRefusal({ path: file, oldText: '', newText: 'b' })).toContain('empty');
    expect(await editRefusal({ path: file, oldText: 'alpha', newText: 'alpha' })).toContain('nothing to change');
  });
  it('treats new text literally ($ signs and all) and can go on editing without a fresh read', async () => {
    await runReadFile({ path: file } as never);
    await runEditFile({ path: file, oldText: 'alpha', newText: 'cost $& $1 done' });
    expect((await readFile(file, 'utf8')).startsWith('cost $& $1 done\n')).toBe(true);
    expect(await editRefusal({ path: file, oldText: 'gamma', newText: 'g' })).toBeNull();
    expect((await editedContent({ path: file, oldText: 'gamma', newText: 'g' }))?.after).toContain('\ng\n');
  });
});

import { TOOLS } from '../src/tools/index.js';
import { session } from '../src/state/session.js';
import { answerApproval, hasPendingApproval } from '../src/agent/permissions.js';
import { untrustProject } from '../src/agent/trust.js';

describe('editFile as a tool: the question shows only the changed lines', () => {
  it('asks with the before/after lines, then changes one part', async () => {
    const options = { toolCallId: 't', messages: [] } as never;
    await runReadFile({ path: file } as never);
    const call = TOOLS.editFile.execute!({ path: file, oldText: 'gamma', newText: 'delta' }, options);
    for (let i = 0; i < 200 && !hasPendingApproval(); i++) await new Promise((r) => setTimeout(r, 5));
    expect(hasPendingApproval()).toBe(true);
    const line = [...session.transcript].reverse().find((e) => e.kind === 'tool');
    expect(line && line.kind === 'tool' ? line.data.detail : '').toContain('- gamma');
    answerApproval(true);
    await call;
    expect(await readFile(file, 'utf8')).toBe('alpha\nbeta\ndelta\nbeta\n');
    untrustProject();
  });
  it('a refused edit never reaches the question', async () => {
    const options = { toolCallId: 't', messages: [] } as never;
    await expect(TOOLS.editFile.execute!({ path: file, oldText: 'gamma', newText: 'delta' }, options)).rejects.toThrow("hasn't been read yet");
    expect(hasPendingApproval()).toBe(false);
  });
});
