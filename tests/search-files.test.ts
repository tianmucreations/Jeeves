import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runSearchFiles, runFindFiles } from '../src/tools/search.js';
import { TOOLS } from '../src/tools/index.js';
import { getSystemPrompt } from '../src/agent/systemPrompt.js';

let dir = '';
const put = (rel: string, text: string | Buffer) => {
  mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  writeFileSync(path.join(dir, rel), text);
};
beforeAll(() => {
  dir = mkdtempSync(path.join(tmpdir(), 'jeeves-search-'));
  put('letters/landlord.txt', 'Dear Landlord,\nThe heating is broken.\nPlease fix the Heating soon.\n');
  put('letters/bank.txt', 'Dear Bank,\nPlease send my statement.\n');
  put('invoices/2026-03.txt', 'Invoice 2026-03: total 120.00\n');
  put('invoices/2026-04.txt', 'Invoice 2026-04: total 95.50\n');
  put('notes/plan.md', 'the heating plan\n');
  put('node_modules/pkg/index.js', 'heating heating heating\n');
  put('.gitignore', 'secret/\n');
  put('secret/keys.txt', 'heating password\n');
  put('photo.png', Buffer.from([0x89, 0x50, 0x00, 0x00, 0x68, 0x65, 0x61, 0x74, 0x69, 0x6e, 0x67]));
  utimesSync(path.join(dir, 'invoices/2026-03.txt'), new Date(2026, 2, 1), new Date(2026, 2, 1));
  utimesSync(path.join(dir, 'invoices/2026-04.txt'), new Date(2026, 3, 1), new Date(2026, 3, 1));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('search inside files and find files by name (Claude Code Grep/Glob, OpenCode grep/glob)', () => {
  it('finds words inside files with the line, grouped by file, skipping ignored folders and non-text files', async () => {
    const out = await runSearchFiles({ pattern: 'heating', path: dir, ignoreCase: true });
    expect(out).toContain('Found 3 matches in 2 files');
    expect(out).toContain('line 2: The heating is broken.');
    expect(out).toContain('line 3: Please fix the Heating soon.');
    expect(out).toContain('notes');
    expect(out).not.toContain('node_modules');
    expect(out).not.toContain('secret');
    expect(out).not.toContain('photo.png');
  });
  it('is case-sensitive unless asked, filters by file name, and takes patterns', async () => {
    expect(await runSearchFiles({ pattern: 'Heating', path: dir })).toContain('Found 1 match in 1 file');
    const onlyMd = await runSearchFiles({ pattern: 'heating', path: dir, include: '*.md' });
    expect(onlyMd).toContain('plan.md');
    expect(onlyMd).not.toContain('landlord');
    expect(await runSearchFiles({ pattern: 'total \\d+\\.\\d+', path: dir, include: '*.txt' })).toContain('Found 2 matches');
  });
  it('says plainly when nothing is found, and copes with a pattern that is not valid', async () => {
    expect(await runSearchFiles({ pattern: 'zebra', path: dir })).toContain('Nothing found for "zebra"');
    expect(await runSearchFiles({ pattern: 'total (', path: dir })).toContain('Nothing found');
  });
  it('caps the list at 100 matches and says so', async () => {
    put('big/many.txt', Array.from({ length: 250 }, (_, i) => `match ${i}`).join('\n'));
    const out = await runSearchFiles({ pattern: 'match', path: path.join(dir, 'big') });
    expect(out).toContain('Found 100+ matches');
    expect(out).toContain('only the first 100 matches are shown');
  });
  it('finds files by name, newest first', async () => {
    const out = await runFindFiles({ pattern: '2026-*.txt', path: dir });
    const lines = out.split('\n');
    expect(lines[0]).toBe(path.join(dir, 'invoices/2026-04.txt'));
    expect(lines[1]).toBe(path.join(dir, 'invoices/2026-03.txt'));
    expect(await runFindFiles({ pattern: '*.docx', path: dir })).toContain('No files named like');
    expect(await runFindFiles({ pattern: 'letters/*.txt', path: dir })).toContain('landlord.txt');
  });
  it('are quiet tools that never ask, offered to the model by name, and refuse a missing folder plainly', async () => {
    const options = { toolCallId: 't', messages: [] } as never;
    expect(String(await TOOLS.searchFiles.execute!({ pattern: 'statement', path: dir }, options))).toContain('bank.txt');
    expect(String(await TOOLS.findFiles.execute!({ pattern: '*.md', path: dir }, options))).toContain('plan.md');
    await expect(runSearchFiles({ pattern: 'x', path: path.join(dir, 'nope') })).rejects.toThrow('does not exist');
    expect(getSystemPrompt()).toContain('searchFiles for words inside files');
  });
});
