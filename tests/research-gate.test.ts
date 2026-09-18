import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  isProgramFile,
  startsNewProject,
  commandEditsFiles,
  asksToSkipResearch,
  isOpenLicence,
  holdForWrite,
  holdForCommand,
  recordNote,
  recordPageOpened,
  recordSearchResults,
  recordWebUnavailable,
  recordCommandResult,
  noteSkipRequest,
  resetResearchGate,
  gateState,
  problemSignature,
  HELD_PREFIX,
} from '../src/agent/research-gate.js';
import { countToolFailures } from '../src/providers/step-control.js';
import { TOOLS } from '../src/tools/index.js';
import { session } from '../src/state/session.js';

let dir: string;
const at = (file: string) => path.join(dir, file);

beforeEach(async () => {
  resetResearchGate();
  dir = await mkdtemp(path.join(tmpdir(), 'jeeves-gate-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const buildNote = (overrides: Record<string, unknown> = {}) =>
  recordNote({
    kind: 'build',
    subject: 'a bakery website',
    sources: ['https://wordpress.org/about/'],
    decision: 'build-new',
    reason: 'A single page is simpler than installing a whole website system.',
    ...overrides,
  });

describe('research gate: what counts as building something new', () => {
  it('program files are code, web pages and scripts; everyday files are not', () => {
    for (const file of ['app.py', 'index.html', 'style.css', 'tool.sh', 'main.ts']) expect(isProgramFile(file), file).toBe(true);
    for (const file of ['letter.txt', 'notes.md', 'budget.csv', 'report.docx', 'data.json']) expect(isProgramFile(file), file).toBe(false);
  });

  it('recognises commands that start a new project', () => {
    for (const command of ['npm create vite@latest shop', 'npx create-react-app shop', 'npm init -y', 'cargo new tool', 'git clone https://github.com/x/y', 'django-admin startproject site'])
      expect(startsNewProject(command), command).toBe(true);
    for (const command of ['npm install', 'npm test', 'git status', 'python app.py']) expect(startsNewProject(command), command).toBe(false);
  });

  it('recognises commands that change files in place, but not ordinary output redirects', () => {
    for (const command of ["sed -i '' 's/a/b/' app.py", 'echo hi > app.py', 'cat a >> b.txt', "perl -pi -e 's/a/b/' x"]) expect(commandEditsFiles(command), command).toBe(true);
    for (const command of ['npm test 2>&1', 'node app.js > /dev/null', 'ls | wc -l', 'git diff']) expect(commandEditsFiles(command), command).toBe(false);
  });

  it('holds a first program file in an empty folder, but not a letter, and not a file added to an existing program', async () => {
    expect(await holdForWrite('app.py', at('app.py'), dir)).toContain(HELD_PREFIX);
    expect(await holdForWrite('letter.txt', at('letter.txt'), dir)).toBeNull();
    await mkdir(at('src'));
    await writeFile(at('src/main.js'), 'console.log(1)');
    expect(await holdForWrite('src/extra.js', at('src/extra.js'), dir)).toBeNull();
  });

  it('holds a new-project command until research is noted', () => {
    expect(holdForCommand('npm create vite@latest shop')).toContain(HELD_PREFIX);
    expect(holdForCommand('npm install left-pad')).toBeNull();
  });
});

describe('research gate: the research note', () => {
  it('only accepts pages really found or opened in this conversation', () => {
    expect(buildNote().ok).toBe(false);
    expect(buildNote().reply).toContain('wordpress.org/about/ was not');
    recordSearchResults(['https://wordpress.org/about/']);
    expect(buildNote().reply).toContain('open at least one');
    recordPageOpened('https://www.wordpress.org/about');
    const accepted = buildNote();
    expect(accepted.ok).toBe(true);
    expect(accepted.shown).toBe(
      'Research — a bakery website: 1 source: wordpress.org. Decision: build new — A single page is simpler than installing a whole website system.'
    );
  });

  it('releases the building hold once a note is accepted', async () => {
    recordPageOpened('https://wordpress.org/about/');
    expect(buildNote().ok).toBe(true);
    expect(await holdForWrite('app.py', at('app.py'), dir)).toBeNull();
    expect(holdForCommand('npm create vite@latest shop')).toBeNull();
  });

  it('checks the licence before anything is reused, and refuses to adapt what may not be reused', () => {
    recordPageOpened('https://wordpress.org/about/');
    expect(buildNote({ decision: 'adapt' }).reply).toContain('state the licence');
    expect(buildNote({ decision: 'adapt', licence: 'All rights reserved' }).reply).toContain('learn the approach only');
    expect(isOpenLicence('GPLv2 or later')).toBe(true);
    expect(isOpenLicence('MIT License')).toBe(true);
    expect(isOpenLicence('unknown')).toBe(false);
    const adapted = buildNote({ decision: 'adapt', licence: 'GPLv2 or later' });
    expect(adapted.ok).toBe(true);
    expect(adapted.shown).toContain('adapt existing work, with credit (licence: GPLv2 or later)');
  });

  it('accepts "no web access" only when the web tools really failed', () => {
    expect(buildNote({ sources: [], noWebAccess: true }).reply).toContain('have not failed');
    recordWebUnavailable();
    const note = buildNote({ sources: [], noWebAccess: true });
    expect(note.ok).toBe(true);
    expect(note.shown).toContain('no web access, so from general knowledge only');
  });
});

describe('research gate: the same problem twice', () => {
  const failing = '$ npm test\n\nexit code: 1\n\nstderr:\nError: Cannot find module ./tax at line 12';

  it('holds changes to existing files after the same failure twice, and asks for research', async () => {
    await writeFile(at('tax.js'), 'x');
    expect(recordCommandResult('npm test', 1, failing)).toBeNull();
    const held = recordCommandResult('npm test', 1, failing.replace('line 12', 'line 14'));
    expect(held).toContain('same failure a second time');
    expect(await holdForWrite('tax.js', at('tax.js'), dir)).toContain('same failure has happened twice');
    expect(holdForCommand("sed -i '' 's/a/b/' tax.js")).toContain(HELD_PREFIX);
    // A new everyday file is still fine.
    expect(await holdForWrite('notes.txt', at('notes.txt'), dir)).toBeNull();
  });

  it('a different failure, or a success in between, is not "the same problem twice"', () => {
    recordCommandResult('npm test', 1, failing);
    expect(recordCommandResult('npm test', 1, '$ npm test\nexit code: 1\nstderr:\nTypeError: x is undefined')).toBeNull();
    recordCommandResult('npm test', 0, 'exit code: 0');
    expect(recordCommandResult('npm test', 1, failing)).toBeNull();
    expect(gateState().heldProblem).toBeNull();
  });

  it('is released only by research done after it happened, with a cause and a fix', async () => {
    recordPageOpened('https://nodejs.org/api/modules.html');
    recordCommandResult('npm test', 1, failing);
    recordCommandResult('npm test', 1, failing);
    const note = { kind: 'problem' as const, subject: 'tests cannot find ./tax', sources: ['https://nodejs.org/api/modules.html'], cause: 'The file is tax.mjs.', fix: 'Import ./tax.mjs.' };
    expect(recordNote(note).reply).toContain('after it happened the second time');
    recordPageOpened('https://nodejs.org/api/esm.html');
    expect(recordNote({ ...note, cause: '' }).reply).toContain('give the cause and the fix');
    const accepted = recordNote({ ...note, sources: ['https://nodejs.org/api/esm.html'] });
    expect(accepted.ok).toBe(true);
    expect(accepted.shown).toBe('Research — tests cannot find ./tax: 1 source: nodejs.org. Cause: The file is tax.mjs. Fix: Import ./tax.mjs.');
    await writeFile(at('tax.js'), 'x');
    expect(await holdForWrite('tax.js', at('tax.js'), dir)).toBeNull();
  });

  it('ignores numbers that change between runs when comparing failures', () => {
    expect(problemSignature('npm test', 'Error at line 12, 0.53s')).toBe(problemSignature('npm test', 'Error at line 14, 0.61s'));
  });
});

describe('research gate: the person can skip it', () => {
  it('recognises asking to skip, and not a request to do research', () => {
    for (const text of ['skip the research and just build it', 'no research needed, make a timer', "don't research, just do it", 'build it without research'])
      expect(asksToSkipResearch(text), text).toBe(true);
    for (const text of ['research the best timer apps', 'please do some research first', 'what did your research find?']) expect(asksToSkipResearch(text), text).toBe(false);
  });

  it('switches both holds off for the conversation, and says so once', async () => {
    expect(noteSkipRequest('skip the research')).toBe('Research skipped for this conversation, as you asked.');
    expect(noteSkipRequest('skip the research')).toBeNull();
    expect(await holdForWrite('app.py', at('app.py'), dir)).toBeNull();
    recordCommandResult('npm test', 1, 'Error: x');
    recordCommandResult('npm test', 1, 'Error: x');
    expect(gateState().heldProblem).toBeNull();
  });
});

describe('research gate: inside the tools', () => {
  it('writeFile holds before asking permission, and a hold is not counted as a failure', async () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      const before = session.transcript.length;
      const run = TOOLS.writeFile.execute!({ path: 'timer.py', content: 'print(1)' }, { toolCallId: 't1', messages: [] } as never);
      await expect(run).rejects.toThrow(HELD_PREFIX);
      expect(session.approvalPending).toBe(false);
      const line = session.transcript.slice(before).find((entry) => entry.kind === 'tool');
      expect(line && line.kind === 'tool' && line.data.state).toBe('held');
      expect(countToolFailures([{ type: 'tool-error', error: new Error(`${HELD_PREFIX} research first`) }])).toBe(0);
      expect(countToolFailures([{ type: 'tool-error', error: new Error('ENOENT') }])).toBe(1);
    } finally {
      process.chdir(cwd);
    }
  });

  it('a harmless look-around that finds nothing, twice, holds nothing', async () => {
    const cwd = process.cwd();
    process.chdir(dir);
    try {
      await writeFile(at('notes.txt'), 'hello');
      for (const id of ['g1', 'g2']) {
        const output = await TOOLS.runBash.execute!({ command: 'grep missing notes.txt' }, { toolCallId: id, messages: [] } as never);
        expect(output).toContain('exit code: 1');
        expect(output).not.toContain(HELD_PREFIX);
      }
      expect(gateState().heldProblem).toBeNull();
    } finally {
      process.chdir(cwd);
    }
  });

  it('noteResearch shows an accepted note to the person', async () => {
    recordPageOpened('https://wordpress.org/about/');
    const before = session.transcript.length;
    const reply = await TOOLS.noteResearch.execute!(
      { kind: 'build', subject: 'a timer', sources: ['https://wordpress.org/about/'], decision: 'build-new', reason: 'Nothing suitable exists for this.' },
      { toolCallId: 't2', messages: [] } as never
    );
    expect(reply).toContain('Recorded');
    const shown = session.transcript.slice(before).find((entry) => entry.kind === 'notice');
    expect(shown && shown.kind === 'notice' && shown.text).toContain('Research — a timer');
  });
});
