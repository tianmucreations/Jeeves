import type { ModelMessage } from 'ai';
import path from 'node:path';
import { session, type TranscriptEntry } from '../state/session.js';
import { getOpenRouterKey } from '../providers/index.js';
import { openrouterChat } from '../tools/web/openrouterChat.js';
import { EXPERT_MODELS } from './auto-ids.js';
import { conversationForExpert, workerModel } from './auto.js';
import { isProgramFile } from './research-gate.js';
import { isReadOnlyBashCommand } from './permissions.js';

// Auto's double-check of finished work (plan step 3).
//
// When: measured on 18 Sept (bench, 61 everyday runs + the 17 Sept hard jobs), the cheap
// worker's mistakes were in writing for someone else to read (invented details, a gap
// left to fill in) and in hard logic from a written specification - never in data files,
// sums, dates, moving files, or jobs touching several files. So the check runs when a
// job changed a program file or wrote a document, and not otherwise.
//
// How: a reviewer on 17 Sept broke a correct job by "fixing" a problem that wasn't there.
// So every problem must come with a concrete example, problems without one are dropped,
// and the worker must reproduce each before changing anything (the approach of Agentless,
// OpenAutoCoder/Agentless: reproduce the issue before accepting a fix) - enforced by
// holding file changes until it has looked or run something after the review.

// Documents written for people: prose, not data.
const DOCUMENT_EXTENSIONS = ['txt', 'md', 'rtf', 'doc', 'docx', 'odt', 'eml', 'tex'];

export function isDocumentFile(file: string): boolean {
  return DOCUMENT_EXTENSIONS.includes(path.extname(file).slice(1).toLowerCase());
}

// The file a writeFile line is about: its summary is "path (N characters)".
function writtenPath(summary: string): string {
  return summary.replace(/\s+\(\d+ characters\)$/, '');
}

// Whether this job's actions call for the double-check.
export function jobNeedsReview(entries: TranscriptEntry[]): boolean {
  return entries.some((entry) => {
    if (entry.kind !== 'tool' || entry.data.state !== 'done') return false;
    if (entry.data.tool === 'writeFile') {
      const file = writtenPath(entry.data.summary);
      return isProgramFile(file) || isDocumentFile(file);
    }
    if (entry.data.tool === 'runBash' && !isReadOnlyBashCommand(entry.data.summary)) {
      // A command that names a program file it may change (an edit, a redirect).
      return /\.(js|mjs|cjs|ts|tsx|jsx|py|rb|php|go|rs|java|sh|html?|css)\b/i.test(entry.data.summary) && /(>|sed\s|perl\s|tee\s|cp\s|mv\s)/.test(entry.data.summary);
    }
    return false;
  });
}

export const REVIEW_INSTRUCTIONS = `You are the expert reviewer for an assistant doing a job on a computer for someone with no technical background. The assistant believes the job is finished. You see the whole conversation: the request, every action, every file written, and every result.
Check the work against what the person asked for - including cases the request clearly implies but does not list. For writing meant for someone else, check that it uses only the facts the person gave and leaves nothing to fill in.
If nothing is wrong, reply with exactly: OK
Otherwise list each problem in exactly this form, and nothing else:
PROBLEM: what is wrong, in one sentence
EXAMPLE: a concrete case that shows it - an input to try, or the exact words quoted from the file
EXPECTED: what should happen or be written
ACTUAL: what the work does or says now
Only report a problem the conversation shows. A problem without a concrete EXAMPLE will be ignored. Never guess.`;

export interface ReviewProblem {
  problem: string;
  example: string;
  expected: string;
  actual: string;
}

// Reads the reviewer's reply. Problems without a concrete example are dropped, so a
// vague "this might be wrong" can never send the worker off changing correct work.
export function parseReview(text: string): { ok: boolean; problems: ReviewProblem[] } {
  if (/^\s*OK\s*\.?\s*$/i.test(text)) return { ok: true, problems: [] };
  const problems: ReviewProblem[] = [];
  for (const block of text.split(/(?=^\s*(?:\d+[.)]\s*)?\**PROBLEM\**\s*:)/im)) {
    const field = (name: string) =>
      block.match(new RegExp(`\\**${name}\\**\\s*:\\s*([\\s\\S]*?)(?=\\n\\s*\\**(?:PROBLEM|EXAMPLE|EXPECTED|ACTUAL)\\**\\s*:|$)`, 'i'))?.[1].trim() ?? '';
    const item = { problem: field('PROBLEM'), example: field('EXAMPLE'), expected: field('EXPECTED'), actual: field('ACTUAL') };
    if (item.problem && item.example.length >= 3) problems.push(item);
  }
  return { ok: problems.length === 0, problems };
}

export function fixRequest(problems: ReviewProblem[]): string {
  const list = problems
    .map((p, i) => `${i + 1}. ${p.problem}\n   Example: ${p.example}\n   Expected: ${p.expected || '(not given)'}\n   Actual: ${p.actual || '(not given)'}`)
    .join('\n');
  return `An expert reviewed your work and reported these problems:\n${list}\n\nThe expert can be wrong. For each one, first reproduce it: run the example, or read the file and find the exact words. Only fix a problem you have reproduced; if you cannot reproduce one, leave the work as it is for that one. Then check the result again and tell the person briefly what was wrong and what you changed, or that the expert's concern did not hold.`;
}

// The reviewers, in order: the expert models still in the catalogue that can use tools.
export function reviewers(catalogue = session.models): string[] {
  if (catalogue.length === 0) return EXPERT_MODELS.slice();
  return EXPERT_MODELS.filter((id) => {
    const params = catalogue.find((model) => model.id === id)?.supportedParameters ?? [];
    return params.includes('tools') || params.includes('tool_choice');
  });
}

export type ReviewOutcome =
  | { kind: 'ok'; reviewer: string }
  | { kind: 'problems'; reviewer: string; problems: ReviewProblem[] }
  | { kind: 'unavailable' };

// Asks each reviewer in turn until one answers; says so plainly when none can.
export async function reviewJob(messages: ModelMessage[], chat = openrouterChat, key = getOpenRouterKey()): Promise<ReviewOutcome> {
  const lineId = session.addToolLine('askExpert', 'final check of the work', 'running');
  try {
    for (const reviewer of key ? reviewers() : []) {
      session.setActiveModel(reviewer);
      try {
        const reply = await chat(key!, {
          model: reviewer,
          messages: [
            { role: 'system', content: REVIEW_INSTRUCTIONS },
            { role: 'user', content: `Conversation:\n${conversationForExpert(messages, 80_000, 6_000)}` },
          ],
          max_tokens: 1500,
        });
        const parsed = parseReview(reply.text);
        session.updateToolLine(lineId, { state: 'done', label: parsed.ok ? 'Expert checked the work' : 'Expert found something to check' });
        return parsed.ok ? { kind: 'ok', reviewer } : { kind: 'problems', reviewer, problems: parsed.problems };
      } catch {
        // This reviewer is unavailable - try the next one.
      }
    }
    session.updateToolLine(lineId, { state: 'failed', label: 'no expert was available' });
    return { kind: 'unavailable' };
  } finally {
    session.setActiveModel(workerModel());
  }
}

export const UNCHECKED_NOTICE =
  "I couldn't have this work double-checked just now - the checking service wasn't reachable. Please look it over before relying on it.";

// While the worker fixes reviewed work, changing files waits until it has reproduced a
// problem: read a file or run something after the review.
let reproducing = false;

export function startReproducing(): void {
  reproducing = true;
}

export function stopReproducing(): void {
  reproducing = false;
}

export const REPRODUCE_HOLD =
  'Held for research: reproduce the reported problem before changing anything - run the example or read the file to find the exact words, then make the fix.';

// Called before a tool runs: a look (readFile, listDir) or a command that is not
// itself an edit counts as reproducing; a change before that is held.
export function holdUntilReproduced(tool: string, detail: string, editsFiles: boolean): string | null {
  if (!reproducing) return null;
  if (tool === 'readFile' || tool === 'listDir' || (tool === 'runBash' && !editsFiles)) {
    reproducing = false;
    return null;
  }
  if (tool === 'writeFile' || (tool === 'runBash' && editsFiles)) return REPRODUCE_HOLD;
  void detail;
  return null;
}
