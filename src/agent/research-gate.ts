import { existsSync } from 'node:fs';
import path from 'node:path';
import fg from 'fast-glob';
import { z } from 'zod';

// Research before building, research before patching - enforced in code, because the
// cheap model skipped a written "check first" rule in every test run (17 Sept).
//
// Copied from Claude Code's file-writing tool (src/tools/FileWriteTool/FileWriteTool.ts,
// validateInput): before a write is even offered for permission, the tool checks what
// has happened in the conversation and refuses with a message saying what to do first
// ("File has not been read yet. Read it first before writing to it."). Its plan mode
// likewise unlocks editing only through a tool the model must call; here that is
// noteResearch.
//
// Two gates:
// - Building: creating a program file in a folder that has none yet (a new program,
//   site, app, tool or script), or running a command that starts a new project, is
//   held until a research note is recorded. Adding a file to an existing program, and
//   everyday files (letters, spreadsheets, notes), are never held.
// - Patching: when the same command fails the same way twice, changing existing files
//   is held until the cause and a fix have been researched.
// The person can say "skip the research"; it is honoured and noted. Code can make
// research happen, not make it good - so every note is shown on screen.

export const HELD_PREFIX = 'Held for research:';

// Program files: code, web pages, styles and scripts. Everyday files are not.
export const PROGRAM_EXTENSIONS = [
  'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx', 'vue', 'svelte', 'html', 'htm', 'css', 'scss', 'py', 'rb', 'php', 'go', 'rs',
  'java', 'kt', 'swift', 'c', 'h', 'cpp', 'cs', 'sh', 'bash', 'zsh', 'ps1', 'bat', 'sql', 'lua', 'pl', 'r', 'dart', 'scala',
];

export function isProgramFile(file: string): boolean {
  const ext = path.extname(file).slice(1).toLowerCase();
  return PROGRAM_EXTENSIONS.includes(ext);
}

// Commands that start a new project from a template or copy one.
const NEW_PROJECT_COMMAND =
  /\b(?:(?:npm|pnpm|yarn|bun)\s+(?:init|create)\b|npx\s+(?:--yes\s+|-y\s+)?create-|cargo\s+(?:new|init)\b|rails\s+new\b|django-admin\s+startproject\b|flutter\s+create\b|dotnet\s+new\b|go\s+mod\s+init\b|git\s+clone\b|composer\s+create-project\b|uv\s+init\b|poetry\s+new\b)/i;

export function startsNewProject(command: string): boolean {
  return NEW_PROJECT_COMMAND.test(command);
}

// Commands that change an existing file in place: sed/perl editing, or output sent
// into a file (">" or ">>", but not "2>&1" or "> /dev/null").
export function commandEditsFiles(command: string): boolean {
  if (/\bsed\s+(?:-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i/.test(command)) return true;
  return /(?:^|[^0-9&>])>{1,2}\s*(?!&|\/dev\/null)[^\s|;&]+/.test(command);
}

// The open licences that allow reuse (with credit, on their terms).
// A version may be joined on ("GPLv2", "LGPLv3").
const OPEN_LICENCE =
  /\b(mit|apache|bsd|isc|mpl|mozilla|gpl|lgpl|agpl|unlicense|cc0|cc[- ]by|creative commons|public domain|zlib|eclipse|epl|wtfpl|0bsd|artistic|python software foundation|psf)(?:v?\d[\d.]*)?\b/i;

export function isOpenLicence(licence: string): boolean {
  return OPEN_LICENCE.test(licence) && !/\b(no licen[cs]e|unknown|none|proprietary|all rights reserved)\b/i.test(licence);
}

// What the person said that switches research off for this conversation.
const SKIP_PHRASE = /\b(?:skip|no|without|don'?t do|do not do|don'?t need|do not need)\s+(?:the\s+|any\s+)?research\b|\bdon'?t research\b|\bdo not research\b/i;

export function asksToSkipResearch(text: string): boolean {
  return SKIP_PHRASE.test(text);
}

interface ProblemRecord {
  count: number;
}

export interface ResearchNote {
  kind: 'build' | 'problem';
  subject: string;
}

// The state of one conversation; /clear starts a fresh one.
class GateState {
  // Pages Jeeves opened with readWebPage, and pages webSearch listed.
  opened = new Set<string>();
  listed = new Set<string>();
  // Set when a web tool could not work (no key, service down).
  webUnavailable = false;
  // How many web pages had been opened when patching was held - research for the
  // problem must come after it.
  openedAtHold = 0;
  openedCount = 0;
  buildNote: ResearchNote | null = null;
  problems = new Map<string, ProblemRecord>();
  // The failure that held patching, until its research is recorded.
  heldProblem: string | null = null;
  skipped = false;
}

let state = new GateState();

export function resetResearchGate(): void {
  state = new GateState();
}

export function gateState(): Readonly<GateState> {
  return state;
}

// Called by the web tools, so a note can only cite pages really found or opened.
export function recordPageOpened(url: string): void {
  const key = normaliseUrl(url);
  if (!state.opened.has(key)) state.openedCount += 1;
  state.opened.add(key);
}

export function recordSearchResults(urls: string[]): void {
  for (const url of urls) state.listed.add(normaliseUrl(url));
}

export function recordWebUnavailable(): void {
  state.webUnavailable = true;
}

export function normaliseUrl(url: string): string {
  try {
    const parsed = new URL(url.trim());
    parsed.hash = '';
    return `${parsed.hostname.replace(/^www\./, '')}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}`.toLowerCase();
  } catch {
    return url.trim().toLowerCase();
  }
}

// The person's own words switch research off - never the model's.
export function noteSkipRequest(userText: string): string | null {
  if (state.skipped || !asksToSkipResearch(userText)) return null;
  state.skipped = true;
  return 'Research skipped for this conversation, as you asked.';
}

// A problem's fingerprint: the command, and the first line of its output that names
// an error, with numbers taken out (line numbers and times change between runs).
export function problemSignature(command: string, output: string): string {
  const lines = output.split('\n').map((line) => line.trim()).filter(Boolean);
  const errorLine =
    lines.find((line) => /error|failed|failure|exception|cannot|can't|not found|undefined|denied|traceback|assert/i.test(line) && !/^exit code:/i.test(line)) ??
    lines.filter((line) => !/^(exit code:|stdout:|stderr:|\$ )/i.test(line)).pop() ??
    '';
  const clean = (text: string) => text.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
  return `${clean(command).slice(0, 120)} => ${clean(errorLine).slice(0, 160)}`;
}

// Called after every command. A command that succeeds clears its record; the same
// failure a second time holds patching until it has been researched.
export function recordCommandResult(command: string, exitCode: number | null, output: string): string | null {
  const commandKey = problemSignature(command, '').split(' => ')[0];
  if (exitCode === 0) {
    for (const key of [...state.problems.keys()]) if (key.startsWith(`${commandKey} => `)) state.problems.delete(key);
    return null;
  }
  const signature = problemSignature(command, output);
  const record = state.problems.get(signature) ?? { count: 0 };
  record.count += 1;
  state.problems.set(signature, record);
  if (record.count >= 2 && state.heldProblem === null && !state.skipped) {
    state.heldProblem = signature;
    state.openedAtHold = state.openedCount;
    return (
      `\n\n${HELD_PREFIX} this is the same failure a second time. Changing files is now held until you research it: ` +
      'find the cause with webSearch and readWebPage (the tool\'s own documentation, its issue tracker, how others fixed it), ' +
      'then record it with noteResearch (kind "problem", with the cause, the fix and the pages you opened). Do not guess another patch.'
    );
  }
  return null;
}

async function folderHasProgramFiles(folder: string): Promise<boolean> {
  if (!existsSync(folder)) return false;
  const found = await fg(`**/*.{${PROGRAM_EXTENSIONS.join(',')}}`, {
    cwd: folder,
    deep: 4,
    onlyFiles: true,
    ignore: ['**/node_modules/**', '**/.git/**', '**/.venv/**', '**/venv/**', '**/dist/**', '**/build/**'],
    suppressErrors: true,
  });
  return found.length > 0;
}

// The project a new file belongs to: the project folder when the file is inside it,
// otherwise the file's own folder.
function projectFolderFor(resolved: string, projectRoot: string): string {
  const relative = path.relative(projectRoot, resolved);
  const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative);
  return inside ? projectRoot : path.dirname(resolved);
}

const BUILD_HOLD =
  `${HELD_PREFIX} this starts something new (a program, site, app, tool or script), and Jeeves researches before building. ` +
  'First look for what already exists: use webSearch and readWebPage to find existing tools, open-source projects and how others have built this. ' +
  'Then call noteResearch (kind "build") with the pages you opened and your decision - use an existing tool as is, adapt one with credit if its licence allows, or build new and why. Then try again.';

const PATCH_HOLD = () =>
  `${HELD_PREFIX} the same failure has happened twice (${state.heldProblem}), so changing files is held until it is researched. ` +
  'Find the cause with webSearch and readWebPage, then call noteResearch (kind "problem") with the cause, the fix and the pages you opened. Then try again.';

// Checked before writeFile is offered for permission. Returns why it is held, or null.
export async function holdForWrite(file: string, resolved: string, projectRoot: string): Promise<string | null> {
  if (state.skipped) return null;
  const exists = existsSync(resolved);
  if (exists && state.heldProblem !== null) return PATCH_HOLD();
  if (exists || state.buildNote || !isProgramFile(file)) return null;
  const folder = projectFolderFor(resolved, projectRoot);
  if (await folderHasProgramFiles(folder)) return null;
  return BUILD_HOLD;
}

// Checked before a command that changes things is offered for permission.
export function holdForCommand(command: string): string | null {
  if (state.skipped) return null;
  if (state.heldProblem !== null && commandEditsFiles(command)) return PATCH_HOLD();
  if (!state.buildNote && startsNewProject(command)) return BUILD_HOLD;
  return null;
}

export const noteResearchSchema = z.object({
  kind: z.enum(['build', 'problem']).describe('"build" before making something new; "problem" after the same failure twice'),
  subject: z.string().min(3).describe('What is being built, or the problem'),
  sources: z.array(z.string()).describe('Addresses of the pages you opened with readWebPage in this conversation'),
  decision: z
    .enum(['use-existing', 'adapt', 'build-new'])
    .optional()
    .describe('For "build": use an existing tool as is, adapt one (licence permitting), or build new'),
  licence: z.string().optional().describe('For use-existing or adapt: the licence of what is reused, exactly as its page states'),
  reason: z.string().optional().describe('For "build": why this decision, in one or two sentences'),
  cause: z.string().optional().describe('For "problem": the cause, as the sources explain it'),
  fix: z.string().optional().describe('For "problem": the fix the sources support'),
  noWebAccess: z.boolean().optional().describe('True only if the web tools could not be used in this conversation'),
});

export type NoteInput = z.output<typeof noteResearchSchema>;

function domain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

const DECISION_WORDS: Record<string, string> = {
  'use-existing': 'use an existing tool as is',
  adapt: 'adapt existing work, with credit',
  'build-new': 'build new',
};

// Records a note, or explains what is missing. Returns the reply for the model and,
// when accepted, the line shown to the person.
export function recordNote(input: NoteInput): { ok: boolean; reply: string; shown?: string } {
  const refuse = (reply: string) => ({ ok: false, reply: `Not recorded: ${reply}` });
  const sources = input.sources.map((url) => url.trim()).filter(Boolean);
  if (input.noWebAccess) {
    if (!state.webUnavailable) return refuse('the web tools have not failed in this conversation - research with webSearch and readWebPage first.');
  } else {
    if (sources.length === 0) return refuse('list the pages you opened with readWebPage.');
    const unknown = sources.filter((url) => !state.opened.has(normaliseUrl(url)) && !state.listed.has(normaliseUrl(url)));
    if (unknown.length > 0) return refuse(`only list pages found or opened in this conversation - ${unknown.join(', ')} ${unknown.length === 1 ? 'was' : 'were'} not.`);
    if (!sources.some((url) => state.opened.has(normaliseUrl(url)))) return refuse('open at least one of these pages with readWebPage first - search results alone are not research.');
  }
  const web = input.noWebAccess ? 'no web access, so from general knowledge only' : `${sources.length} source${sources.length === 1 ? '' : 's'}: ${[...new Set(sources.map(domain))].join(', ')}`;

  if (input.kind === 'build') {
    if (!input.decision) return refuse('give a decision: use-existing, adapt or build-new.');
    if (!input.reason || input.reason.trim().length < 10) return refuse('give the reason for the decision.');
    if (input.decision !== 'build-new') {
      if (!input.licence?.trim()) return refuse('state the licence of what you would reuse, as its page states it.');
      if (input.decision === 'adapt' && !isOpenLicence(input.licence)) {
        return refuse(`"${input.licence}" does not allow reuse - learn the approach only, and record the decision as build-new.`);
      }
    }
    state.buildNote = { kind: 'build', subject: input.subject };
    const licence = input.decision !== 'build-new' && input.licence ? ` (licence: ${input.licence.trim()})` : '';
    const shown = `Research — ${input.subject}: ${web}. Decision: ${DECISION_WORDS[input.decision]}${licence} — ${input.reason.trim()}`;
    return { ok: true, reply: 'Recorded. Building is no longer held for this conversation.', shown };
  }

  if (!input.cause?.trim() || !input.fix?.trim()) return refuse('give the cause and the fix, as the sources explain them.');
  if (state.heldProblem !== null && !input.noWebAccess && state.openedCount <= state.openedAtHold) {
    return refuse('open at least one page about this problem with readWebPage after it happened the second time.');
  }
  const wasHeld = state.heldProblem;
  state.heldProblem = null;
  if (wasHeld) state.problems.delete(wasHeld);
  const shown = `Research — ${input.subject}: ${web}. Cause: ${input.cause.trim()} Fix: ${input.fix.trim()}`;
  return { ok: true, reply: wasHeld ? 'Recorded. Changing files is no longer held.' : 'Recorded.', shown };
}
