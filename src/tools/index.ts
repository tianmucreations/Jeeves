import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { session } from '../state/session.js';
import { requestApproval, isReadOnlyBashCommand } from '../agent/permissions.js';
import { readFileSchema, runReadFile } from './readFile.js';
import { writeFileSchema, runWriteFile } from './writeFile.js';
import { listDirSchema, runListDir } from './listDir.js';
import { runBashSchema, runRunBash } from './runBash.js';
import { webSearchSchema, runWebSearch, readWebPageSchema, runReadWebPage } from './web/research.js';
import { ensureCheckpoint, isOutsideProject, commandMayReachOutside } from '../checkpoints/index.js';

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
  if (text.includes('timed out') || text.includes('etimedout') || text.includes('stopped after') || text.includes("didn't finish")) return 'took too long';
  if (text.includes('binary file')) return 'not a text file';
  if (text.includes('web search needs an openrouter key')) return 'needs an OpenRouter key (type /keys)';
  if (text.includes('web search is not available')) return 'web search is not available right now';
  if (text.includes("couldn't open")) return "that website wouldn't open";
  if (text.includes('not a valid web address') || text.includes('only web pages')) return 'not a web address';
  if (text.includes('needs an interactive terminal')) return 'that program needs typing in a window of its own';
  // Anything unrecognised stays off screen; the model receives the full message
  // and explains it in plain English.
  return 'something unexpected went wrong'
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
}) {
  return tool({
    description: config.description,
    inputSchema: config.schema,
    execute: async (rawInput) => {
      // The SDK validates before execute; parsing again keeps this layer strictly typed.
      const input = config.schema.parse(rawInput);
      const summary = config.summarize(input);
      const needsPermission =
        typeof config.permission === 'function' ? config.permission(input) : config.permission;
      const warning = config.warning?.(input) ?? null;
      if (warning) session.addNotice(warning);
      const lineId = session.addToolLine(config.name, summary, needsPermission ? 'awaiting' : 'running');
      if (needsPermission) {
        const approved = await requestApproval();
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

export const TOOLS: ToolSet = {
  readFile: defineTool({
    name: 'readFile',
    description: 'Read the contents of a text file at the given path.',
    schema: readFileSchema,
    permission: false,
    summarize: (input) => input.path,
    label: (input) => `Read ${input.path}`,
    run: runReadFile,
  }),
  listDir: defineTool({
    name: 'listDir',
    description: 'List the files and folders in a directory, ignoring .gitignore rules. Set recursive to true to include subfolders.',
    schema: listDirSchema,
    permission: false,
    summarize: (input) => input.path,
    label: (input, result) => `Listed ${input.path} (${result.split('\n').length} items)`,
    run: runListDir,
  }),
  writeFile: defineTool({
    name: 'writeFile',
    description: 'Write text content to a file, creating the file if it does not exist.',
    schema: writeFileSchema,
    permission: true,
    summarize: (input) => `${input.path} (${input.content.length} characters)`,
    label: () => 'Wrote 1 file',
    run: runWriteFile,
    changesFiles: () => true,
    warning: (input) =>
      isOutsideProject(input.path)
        ? `Heads up: ${input.path} is outside your project folder, so /undo can't reverse this change.`
        : null,
  }),
  webSearch: defineTool({
    name: 'webSearch',
    description: 'Search the web. Returns titles, addresses and short snippets - a list of where to look, not checked facts.',
    schema: webSearchSchema,
    permission: false,
    summarize: (input) => clip(input.query, 60),
    label: (input) => `Searched ${clip(input.query, 60)}`,
    run: runWebSearch,
  }),
  readWebPage: defineTool({
    name: 'readWebPage',
    description: 'Open a web page and find one fact on it. Returns the answer with the exact quote from the page, or says it is not stated there.',
    schema: readWebPageSchema,
    permission: false,
    summarize: (input) => clip(input.url, 60),
    label: (input) => `Read ${clip(input.url.replace(/^https?:\/\//, ''), 60)}`,
    run: runReadWebPage,
  }),
  runBash: defineTool({
    name: 'runBash',
    description: 'Run a shell command and return its output.',
    schema: runBashSchema,
    // Read-only commands never ask (the allowlist lives in permissions.ts);
    // everything else - writes, deletes, installs, network - still prompts.
    permission: (input) => !isReadOnlyBashCommand(input.command),
    summarize: (input) => clip(input.command, 60),
    label: (input) => `Ran ${clip(input.command, 60)}`,
    run: runRunBash,
    changesFiles: (input) => !isReadOnlyBashCommand(input.command),
    warning: (input) =>
      !isReadOnlyBashCommand(input.command) && commandMayReachOutside(input.command)
        ? "Heads up: this command may change things outside your project folder, which /undo can't reverse."
        : null,
  }),
};

export function getTools(): ToolSet {
  return TOOLS;
}