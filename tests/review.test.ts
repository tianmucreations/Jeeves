import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  jobNeedsReview,
  parseReview,
  fixRequest,
  reviewers,
  reviewJob,
  holdUntilReproduced,
  startReproducing,
  stopReproducing,
  isDocumentFile,
} from '../src/agent/review.js';
import { session, type TranscriptEntry } from '../src/state/session.js';
import { TOOLS } from '../src/tools/index.js';
import { resetResearchGate } from '../src/agent/research-gate.js';
import { REVIEW_FINISHED_JOBS } from '../src/agent/auto.js';

const tool = (tool: string, summary: string, state: 'done' | 'failed' = 'done'): TranscriptEntry => ({ id: 1, kind: 'tool', data: { tool, summary, state, label: '' } });

describe('double-check: when it runs', () => {
  it('is on in Auto mode unless switched off for testing', () => {
    expect(REVIEW_FINISHED_JOBS).toBe(process.env.JEEVES_REVIEW !== '0');
    expect(process.env.JEEVES_REVIEW === '0' || REVIEW_FINISHED_JOBS).toBe(true);
  });

  it('after a program file or a document was written', () => {
    expect(jobNeedsReview([tool('writeFile', 'calc.js (2400 characters)')])).toBe(true);
    expect(jobNeedsReview([tool('writeFile', 'letter.txt (800 characters)')])).toBe(true);
    expect(jobNeedsReview([tool('writeFile', 'index.html (900 characters)')])).toBe(true);
  });

  it('not for data files, moving files, looking around, or a write that failed - where no mistakes were measured', () => {
    expect(jobNeedsReview([tool('writeFile', 'invoice.csv (300 characters)')])).toBe(false);
    expect(jobNeedsReview([tool('writeFile', 'summary.json (80 characters)')])).toBe(false);
    expect(jobNeedsReview([tool('runBash', 'mkdir Pictures && mv holiday.jpg cat.PNG Pictures/')])).toBe(false);
    expect(jobNeedsReview([tool('readFile', 'calc.js'), tool('runBash', 'ls -la')])).toBe(false);
    expect(jobNeedsReview([tool('writeFile', 'calc.js (2400 characters)', 'failed')])).toBe(false);
    expect(jobNeedsReview([])).toBe(false);
  });

  it('after a command that edits a program file', () => {
    expect(jobNeedsReview([tool('runBash', "sed -i '' 's/123/999/' index.html")])).toBe(true);
    expect(jobNeedsReview([tool('runBash', 'npm test')])).toBe(false);
  });

  it('knows documents from data', () => {
    for (const file of ['letter.txt', 'notes.md', 'cv.docx']) expect(isDocumentFile(file), file).toBe(true);
    for (const file of ['data.csv', 'a.json', 'b.xlsx', 'app.js']) expect(isDocumentFile(file), file).toBe(false);
  });
});

describe('double-check: what the reviewer must give', () => {
  it('reads OK as nothing wrong', () => {
    expect(parseReview('OK')).toEqual({ ok: true, problems: [] });
    expect(parseReview('  ok. ')).toEqual({ ok: true, problems: [] });
  });

  it('keeps problems that come with a concrete example', () => {
    const review = parseReview(
      'PROBLEM: Powers group the wrong way.\nEXAMPLE: 2^3^2\nEXPECTED: 512\nACTUAL: 64\n\nPROBLEM: The letter adds a detail.\nEXAMPLE: "the radiators give no heat at all"\nEXPECTED: only the broken boiler\nACTUAL: invents radiators'
    );
    expect(review.ok).toBe(false);
    expect(review.problems).toEqual([
      { problem: 'Powers group the wrong way.', example: '2^3^2', expected: '512', actual: '64' },
      { problem: 'The letter adds a detail.', example: '"the radiators give no heat at all"', expected: 'only the broken boiler', actual: 'invents radiators' },
    ]);
  });

  it('drops a problem without an example, so a vague worry can never change correct work', () => {
    expect(parseReview('PROBLEM: This might not handle every case.\nEXPECTED: more care')).toEqual({ ok: true, problems: [] });
    expect(parseReview('The code looks a bit fragile.').ok).toBe(true);
    expect(parseReview('1. **PROBLEM:** Wrong total.\n**EXAMPLE:** hours.csv row 2026-09-09\n**EXPECTED:** 90\n**ACTUAL:** missing').problems).toHaveLength(1);
  });

  it('asks the worker to reproduce each problem first, and says the expert can be wrong', () => {
    const text = fixRequest([{ problem: 'Wrong total.', example: '2+2', expected: '4', actual: '5' }]);
    expect(text).toContain('The expert can be wrong');
    expect(text).toContain('first reproduce it');
    expect(text).toContain('Example: 2+2');
  });
});

describe('double-check: reviewers and fallbacks', () => {
  const catalogue = (ids: string[]) => ids.map((id) => ({ id, name: id, contextLength: 1, promptPrice: 1, completionPrice: 1, supportedParameters: ['tools'], provider: 'x' }));

  it('uses the expert models still in the catalogue, in order', () => {
    expect(reviewers(catalogue(['anthropic/claude-opus-5', 'z-ai/glm-5.3']))).toEqual(['z-ai/glm-5.3', 'anthropic/claude-opus-5']);
  });

  it('tries the next reviewer when one fails, and says plainly when none can check', async () => {
    session.setModels(catalogue(['anthropic/claude-sonnet-5', 'z-ai/glm-5.3']), '');
    const asked: string[] = [];
    const flaky = async (_key: string, body: Record<string, unknown>) => {
      asked.push(String(body.model));
      if (body.model === 'anthropic/claude-sonnet-5') throw new Error('503');
      return { text: 'OK', citations: [], cost: 0 };
    };
    expect(await reviewJob([], flaky, 'test-key')).toEqual({ kind: 'ok', reviewer: 'z-ai/glm-5.3' });
    expect(asked).toEqual(['anthropic/claude-sonnet-5', 'z-ai/glm-5.3']);
    const down = async () => {
      throw new Error('down');
    };
    expect(await reviewJob([], down, 'test-key')).toEqual({ kind: 'unavailable' });
    expect(await reviewJob([], flaky, null)).toEqual({ kind: 'unavailable' });
    session.setModels([], '');
  });
});

describe('double-check: reproduce before changing anything', () => {
  let dir: string;
  beforeEach(async () => {
    resetResearchGate();
    dir = await mkdtemp(path.join(tmpdir(), 'jeeves-review-'));
  });
  afterEach(async () => {
    stopReproducing();
    await rm(dir, { recursive: true, force: true });
  });

  it('holds a change until something has been looked at or run', () => {
    startReproducing();
    expect(holdUntilReproduced('writeFile', 'calc.js', true)).toContain('reproduce the reported problem');
    expect(holdUntilReproduced('runBash', "sed -i '' 's/a/b/' calc.js", true)).toContain('reproduce');
    expect(holdUntilReproduced('runBash', 'node -e "console.log(2**3**2)"', false)).toBeNull();
    expect(holdUntilReproduced('writeFile', 'calc.js', true)).toBeNull();
  });

  it('holds nothing outside a fix after a review', () => {
    expect(holdUntilReproduced('writeFile', 'calc.js', true)).toBeNull();
  });

  it('inside the real tools: the write waits, a read releases it', async () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await writeFile(path.join(dir, 'letter.txt'), 'Dear Mr Patel');
      startReproducing();
      const options = { toolCallId: 'r1', messages: [] } as never;
      await expect(TOOLS.writeFile.execute!({ path: 'letter.txt', content: 'x' }, options)).rejects.toThrow('reproduce the reported problem');
      const held = [...session.transcript].reverse().find((entry) => entry.kind === 'tool');
      expect(held && held.kind === 'tool' && held.data.label).toBe('waits until the problem is reproduced');
      await TOOLS.readFile.execute!({ path: 'letter.txt' }, options);
      expect(holdUntilReproduced('writeFile', 'letter.txt', true)).toBeNull();
    } finally {
      process.chdir(cwd);
    }
  });
});
