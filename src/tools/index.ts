import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import { session } from '../state/session.js';
import { requestApproval, isReadOnlyBashCommand } from '../agent/permissions.js';
import { readFileSchema, runReadFile } from './readFile.js';
import { writeFileSchema, runWriteFile } from './writeFile.js';
import { listDirSchema, runListDir } from './listDir.js';
import { runBashSchema, runRunBash } from './runBash.js';

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
      const lineId = session.addToolLine(config.name, summary, needsPermission ? 'awaiting' : 'running');
      if (needsPermission) {
        const approved = await requestApproval();
        if (!approved) {
          session.updateToolLine(lineId, { state: 'declined' });
          throw new Error(`Permission denied by the user - ${config.name} ${summary} was not executed.`);
        }
        session.updateToolLine(lineId, { state: 'running' });
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
  }),
};

export function getTools(): ToolSet {
  return TOOLS;
}