import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtemp, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { runReadFile } from '../src/tools/readFile.js';
import { resetSeenFiles } from '../src/tools/write-safety.js';
import { TOOLS } from '../src/tools/index.js';

// Claude Code's reading discipline (FileReadTool): big files come 2,000 lines at
// a time with "continue with offset" told to the model, one read is size-capped,
// and a plain re-read of an unchanged file returns a note instead of paying for
// the same text twice. The spill test covers the other half: an oversized tool
// answer is SAVED with its place named (toolResultStorage.ts), never cut off
// blind. The old code fed huge files in whole and said "[output truncated]".

const options = { toolCallId: 't', messages: [] } as never;

describe('reading big files in pieces', () => {
  let dir: string;
  let big: string;
  const total = 5_000;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), 'jeeves-readsafety-'));
    big = path.join(dir, 'big.txt');
    await writeFile(big, Array.from({ length: total }, (_, i) => `line ${i + 1}`).join('\n'));
    resetSeenFiles();
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
    resetSeenFiles();
  });

  it('a plain read returns the first 2000 lines and says how to continue', async () => {
    const out = await runReadFile({ path: big });
    expect(out).toContain('line 1\n');
    expect(out).toContain('line 2000');
    expect(out).not.toContain('line 2001');
    expect(out).toContain('continue with offset=2001');
  });

  it('offset continues from the line asked for', async () => {
    const out = await runReadFile({ path: big, offset: 2001 });
    expect(out).toContain('starting from line 2001');
    expect(out).toContain('line 2001');
    expect(out).toContain('line 4000');
    expect(out).toContain('continue with offset=4001');
  });

  it('limit reads fewer lines, and the last part comes with no continuation', async () => {
    const out = await runReadFile({ path: big, offset: 4900, limit: 101 });
    expect(out).toContain('line 4900');
    expect(out).toContain('line 5000');
    expect(out).not.toContain('continue with offset');
  });

  it('an offset past the end serves the last line', async () => {
    const out = await runReadFile({ path: big, offset: 99_000 });
    expect(out).toContain('line 5000');
  });

  it('a size cap applies even within the line limit, with a way onward', async () => {
    const wide = path.join(dir, 'wide.txt');
    await writeFile(wide, Array.from({ length: 10 }, (_, i) => `${i} ${'x'.repeat(20_000)}`).join('\n'));
    const out = await runReadFile({ path: wide, limit: 10 });
    expect(out.length).toBeLessThan(110_000);
    expect(out).toContain('stopped at the size limit');
  });

  it('a plain re-read of an unchanged file is a note, not the text again', async () => {
    const out = await runReadFile({ path: big });
    expect(out).toContain('has not changed since you read it');
  });

  it('a re-read with offset still serves the requested part', async () => {
    const out = await runReadFile({ path: big, offset: 4900, limit: 101 });
    expect(out).toContain('line 5000');
  });

  it('an empty file says so', async () => {
    const empty = path.join(dir, 'empty.txt');
    await writeFile(empty, '');
    expect(await runReadFile({ path: empty })).toBe('(this file is empty)');
  });
});

describe('oversized answers are saved, not lost', () => {
  afterAll(async () => {
    await rm(path.join(tmpdir(), 'jeeves-tool-results'), { recursive: true, force: true }).catch(() => {});
  });

  it('a result past the cap keeps its start and names where the whole thing went', async () => {
    const run = TOOLS.runBash.execute!({ command: 'yes 0 | head -c 200000' }, options);
    const out = (await run) as string;
    expect(out.length).toBeLessThan(3_000);
    expect(out).toContain('the whole thing is saved at');
    const spillPath = /saved at (\S+) - /.exec(out)?.[1];
    expect(spillPath).toBeTruthy();
    // The saved file holds the complete answer, readable in pieces like any file.
    const spilled = await runReadFile({ path: spillPath! });
    expect(spilled).toContain('0');
    const files = await readdir(path.join(tmpdir(), 'jeeves-tool-results'));
    expect(files.length).toBe(1);
  });
});
