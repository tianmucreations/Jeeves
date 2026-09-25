import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { session } from '../state/session.js';
import { requestApproval, isReadOnlyBashCommand } from '../agent/permissions.js';
import { readFileSchema, runReadFile } from './readFile.js';
import { writeFileSchema, runWriteFile } from './writeFile.js';
import { listDirSchema, runListDir } from './listDir.js';
import { runBashSchema, runRunBash } from './runBash.js';
import { webSearchSchema, runWebSearch, readWebPageSchema, runReadWebPage, researchService, borrowedSearchNeedsAsking, borrowedSearchQuestion } from './web/research.js';
import { ensureCheckpoint, isOutsideProject, commandMayReachOutside } from '../checkpoints/index.js';
import { resolveFromCwd } from '../platform/paths.js';
import { isProjectTrusted, isPathTrusted, isCommandTrusted, isCommandFamilyTrusted } from '../agent/trust.js';
import {
  holdForWrite,
  holdForCommand,
  recordCommandResult,
  recordNote,
  noteResearchSchema,
  HELD_PREFIX,
  commandEditsFiles,
} from '../agent/research-gate.js';
import { holdUntilReproduced } from '../agent/review.js';
import { describeCommand, describeDone } from './describe.js';
import { PlainError } from './plain.js';

// Assumption: every tool result is capped to keep huge outputs from flooding the conversation.
const MAX_RESULT_CHARS = 150_000;

function truncate(text: string): string {
  return text.length > MAX_RESULT_CHARS ? text.slice(0, MAX_RESULT_CHARS) + '\n[output truncated]' : text;
}

function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

// Plain-English one-line failure text for the transcript; the model still receives
// the full technical message so it can react.
export function plainToolFailure(error: unknown): string {
  // Errors the tool already worded for the person are shown exactly as thrown.
  if (error instanceof PlainError) return error.message;
  const raw = describeError(error);
  const text = raw.toLowerCase();
  // Codes and meanings per the Node.js docs' "Common system errors" list.
  if (text.includes('enoent')) return "couldn't find that file or folder";
  if (text.includes('eacces') || text.includes('eperm')) return "the computer wouldn't allow it";
  if (text.includes('eisdir')) return 'that is a folder, not a file';
  if (text.includes('enotdir')) return 'part of that location is not a folder';
  if (text.includes('eexist')) return 'something with that name already exists';
  if (text.includes('enotempty')) return 'that folder is not empty';
  if (text.includes('no space left')) return 'the disk is full';
  // Say how long it was allowed ("didn't finish in 2 minutes"), not just "took too long".
  const limit = /didn't finish in ([0-9]+ (?:minutes?|seconds))/.exec(raw)?.[1];
  if (limit) return `still running after ${limit}, so it was stopped`;
  if (text.includes('timed out') || text.includes('etimedout') || text.includes('stopped after') || text.includes("didn't finish")) return 'took too long';
  if (text.includes('binary file')) return 'not a text file';
  if (text.includes('web search needs an openrouter key')) return 'needs an OpenRouter key (type /keys)';
  if (text.includes('web search is not available')) return 'web search is not available right now';
  if (text.includes("web search isn't available with")) return "web search isn't available with this service yet";
  if (text.includes('was not allowed in this conversation')) return 'not allowed';
  if (text.includes('needs your z.ai key')) return 'needs your Z.ai key (type /keys)';
  if (text.includes("couldn't open")) return "that website wouldn't open";
  if (text.includes('not a valid web address') || text.includes('only web pages')) return 'not a web address';
  if (text.includes('needs an interactive terminal')) return 'that program needs typing in a window of its own';
  // Anything unrecognised stays off screen; the model receives the full message
  // and explains it in plain English.
  return 'something unexpected went wrong'
}

function researchLabel(): string {
  const service = researchService();
  return service === 'zai' ? ' (Z.ai plan)' : service === 'borrowed' ? ' (via OpenRouter)' : '';
}

function clip(text: string, max: number): string {
  return text.length > max ? text.slice(0, max - 1) + '…' : text;
}

function defineTool<S extends z.ZodObject>(config: {
  name: string;
  description: string;
  schema: S;
  permission: boolean | ((input: z.output<S>) => boolean);
  summarize: (input: z.output<S>) => string;
  label: (input: z.output<S>, result: string) => string;
  run: (input: z.output<S>) => Promise<string>;
  // Whether this action can change files - if so, the project folder is backed up
  // first, so /undo can put it back.
  changesFiles?: (input: z.output<S>) => boolean;
  // A plain warning shown before asking, when /undo could not reverse this action.
  warning?: (input: z.output<S>) => string | null;
  // True when this exact target is already covered by a folder trusted before
  // (a different project folder the person said "always allow" in directly) - no
  // warning, no question, same as an ordinary trusted in-project action.
  alreadyTrustedElsewhere?: (input: z.output<S>) => boolean;
  // For shell commands: the command text, carried onto the question so "always
  // allow this kind of command" can remember its family for the project.
  approvalCommand?: (input: z.output<S>) => string;
  // The heads-up is folded into the tool's own question line instead of shown
  // as a separate notice above it (one line, not two alarming ones).
  warningInline?: boolean;
  // Checked before anything is asked or done (as Claude Code's validateInput): a
  // reason the action is held, which goes back to the model, or null.
  hold?: (input: z.output<S>) => Promise<string | null> | string | null;
}) {
  return tool({
    description: config.description,
    inputSchema: config.schema,
    execute: async (rawInput) => {
      // The SDK validates before execute; parsing again keeps this layer strictly typed.
      const input = config.schema.parse(rawInput);
      const summary = config.summarize(input);
      const held = (await config.hold?.(input)) ?? null;
      if (held) {
        const heldLine = session.addToolLine(config.name, summary, 'running');
        session.updateToolLine(heldLine, {
          state: 'held',
          label: held.includes('reproduce the reported problem') ? 'waits until the problem is reproduced' : 'waits until the research is done',
        });
        throw new Error(held);
      }
      const coveredElsewhere = config.alreadyTrustedElsewhere?.(input) ?? false;
      const warning = coveredElsewhere ? null : (config.warning?.(input) ?? null);
      // A change inside the project folder (no outside warning) may be "always allowed".
      const trustable = warning === null;
      const needsPermission =
        (typeof config.permission === 'function' ? config.permission(input) : config.permission) &&
        !(trustable && (coveredElsewhere || isProjectTrusted()));
      if (warning && !config.warningInline) session.addNotice(warning);
      const lineId = session.addToolLine(config.name, summary, needsPermission ? 'awaiting' : 'running');
      if (needsPermission) {
        const approved = await requestApproval({ trustable, command: config.approvalCommand?.(input) });
        if (!approved) {
          session.updateToolLine(lineId, { state: 'declined' });
          throw new Error(`Permission denied by the user - ${config.name} ${summary} was not executed.`);
        }
        session.updateToolLine(lineId, { state: 'running' });
      }
      if (config.changesFiles?.(input)) {
        const backup = await ensureCheckpoint();
        if (!backup.ok) {
          session.addNotice("I couldn't back up the project folder first, so this change couldn't be undone. Go ahead anyway? (y/n)");
          if (!(await requestApproval())) {
            session.updateToolLine(lineId, { state: 'declined' });
            throw new Error(`Not done: the folder could not be backed up first (${backup.problem}), and the person chose not to go ahead.`);
          }
        }
      }
      try {
        const result = truncate(await config.run(input));
        session.updateToolLine(lineId, { state: 'done', label: config.label(input, result) });
        return result;
      } catch (error) {
        session.updateToolLine(lineId, { state: 'failed', label: plainToolFailure(error) });
        throw error;
      }
    },
  });
}

// Whether a shell command needs the person's yes: anything not on the read-only
// list, except a command whose kind was allowed in this folder before AND that
// stays inside the project folder. 25 Sept: a remembered kind used to wave the
// command through no matter where it pointed - a folder landed in the person's
// HOME folder that way. "Always allow" covers this folder's own drawers only;
// anything reaching outside (the home folder included) asks every time, with the
// outside warning on the question and no Always Allow button (/undo can't cover it).
export function runBashNeedsPermission(command: string): boolean {
  return !isReadOnlyBashCommand(command) && !(isCommandFamilyTrusted(command) && !commandMayReachOutside(command));
}

export const TOOLS: ToolSet = {
  readFile: defineTool({
    name: 'readFile',
    description: 'Read the contents of a text file at the given path.',
    schema: readFileSchema,
    permission: false,
    summarize: (input) => input.path,
    label: (input) => `Read ${input.path}`,
    run: runReadFile,
    hold: (input) => holdUntilReproduced('readFile', input.path, false),
  }),
  listDir: defineTool({
    name: 'listDir',
    description: 'List the files and folders in a directory, ignoring .gitignore rules. Set recursive to true to include subfolders.',
    schema: listDirSchema,
    permission: false,
    summarize: (input) => input.path,
    label: (input, result) => `Listed ${input.path} (${result.split('\n').length} items)`,
    run: runListDir,
    hold: (input) => holdUntilReproduced('listDir', input.path, false),
  }),
  writeFile: defineTool({
    name: 'writeFile',
    description: 'Write text content to a file, creating the file if it does not exist.',
    schema: writeFileSchema,
    permission: true,
    summarize: (input) => `${input.path} (${input.content.length} characters)`,
    label: () => 'Wrote 1 file',
    run: runWriteFile,
    hold: async (input) => holdUntilReproduced('writeFile', input.path, true) ?? (await holdForWrite(input.path, resolveFromCwd(input.path), process.cwd())),
    changesFiles: () => true,
    warning: (input) =>
      isOutsideProject(input.path)
        ? `Heads up: ${input.path} is outside your project folder, so /undo can't reverse this change.`
        : null,
    alreadyTrustedElsewhere: (input) => isOutsideProject(input.path) && isPathTrusted(input.path),
  }),
  webSearch: defineTool({
    name: 'webSearch',
    description: 'Search the web. Returns titles, addresses and short snippets - a list of where to look, not checked facts.',
    schema: webSearchSchema,
    // On a service with no search of its own, a search borrows OpenRouter (about a cent
    // each) only after a yes, asked once per conversation - never "always allowed".
    permission: () => borrowedSearchNeedsAsking(),
    warning: () => (borrowedSearchNeedsAsking() ? borrowedSearchQuestion() : null),
    summarize: (input) => clip(input.query, 60),
    // Every search line says which service it went through.
    label: (input) => `Searched ${clip(input.query, 50)}${researchLabel()}`,
    run: runWebSearch,
  }),
  readWebPage: defineTool({
    name: 'readWebPage',
    description: 'Open a web page and find one fact on it. Returns the answer with the exact quote from the page, or says it is not stated there.',
    schema: readWebPageSchema,
    permission: false,
    summarize: (input) => clip(input.url, 60),
    label: (input) => `Read ${clip(input.url.replace(/^https?:\/\//, ''), 50)}${researchService() === 'zai' ? ' (Z.ai plan)' : ''}`,
    run: runReadWebPage,
  }),
  runBash: defineTool({
    name: 'runBash',
    description: 'Run a shell command and return its output.',
    schema: runBashSchema,
    // Read-only commands never ask (the allowlist lives in permissions.ts);
    // command kinds the person has already allowed in this folder don't ask
    // either - but only while the command stays inside this project folder
    // (see runBashNeedsPermission).
    permission: (input) => runBashNeedsPermission(input.command),
    approvalCommand: (input) => input.command,
    warningInline: true,
    summarize: (input) => {
      const described = describeCommand(input.command);
      // The outside-folder heads-up rides on the question itself: one plain line,
      // not a separate warning above it (owner, 24 Sept: the old pair looked
      // "shocking and confusing").
      if (!isReadOnlyBashCommand(input.command) && !isCommandTrusted(input.command) && commandMayReachOutside(input.command)) {
        return `${described} (outside this project)`;
      }
      return described;
    },
    label: (input) => describeDone(input.command),
    run: async (input) => {
      const output = await runRunBash(input);
      // Looking around (a search that finds nothing exits 1) is not a problem to research.
      if (isReadOnlyBashCommand(input.command)) return output;
      const exit = output.match(/^exit code: (\d+|unknown)$/m)?.[1];
      const note = recordCommandResult(input.command, exit === undefined || exit === 'unknown' ? null : Number(exit), output);
      return note ? output + note : output;
    },
    hold: (input) =>
      holdUntilReproduced('runBash', input.command, commandEditsFiles(input.command)) ??
      (isReadOnlyBashCommand(input.command) ? null : holdForCommand(input.command)),
    changesFiles: (input) => !isReadOnlyBashCommand(input.command),
    warning: (input) =>
      !isReadOnlyBashCommand(input.command) && commandMayReachOutside(input.command)
        ? "Heads up: this command may change things outside your project folder, which /undo can't reverse."
        : null,
    alreadyTrustedElsewhere: (input) =>
      !isReadOnlyBashCommand(input.command) && commandMayReachOutside(input.command) && isCommandTrusted(input.command),
  }),
};

// Research before building or patching: the note that releases a hold. Shown to the
// person in full, because code can make research happen but not make it good.
TOOLS.noteResearch = defineTool({
  name: 'noteResearch',
  description:
    'Record your research before building something new (kind "build") or after the same failure twice (kind "problem"). List only pages you opened with readWebPage in this conversation.',
  schema: noteResearchSchema,
  permission: false,
  summarize: (input) => clip(input.subject, 60),
  label: (_input, result) => (result.startsWith('Recorded') ? 'Research noted' : 'Research note not accepted yet'),
  run: async (input) => {
    const outcome = recordNote(input);
    if (outcome.shown) session.addNotice(outcome.shown);
    return outcome.reply;
  },
});

export { HELD_PREFIX };

export function getTools(): ToolSet {
  return TOOLS;
}