import { tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { session } from '../state/session.js';
import { getOpenRouterKey } from '../providers/index.js';
import { openrouterChat } from '../tools/web/openrouterChat.js';

// Auto mode: a cheap worker with an expert on call - the pattern Claude Code
// publishes as its "advisor" (code.claude.com/docs/en/advisor): the main model does
// the routine work and consults a stronger model at decision points (before
// committing to an approach, when an error keeps recurring, before declaring a task
// done), which costs less than running the stronger model throughout. No guessing
// whether a message is "chat" or "work": the cheap model is always first.

import { AUTO_MODEL_ID, AUTO_WORKER_MODEL, AUTO_EXPERT_MODEL, AUTO_TOP_MODEL } from './auto-ids.js';
export { AUTO_MODEL_ID, AUTO_WORKER_MODEL, AUTO_EXPERT_MODEL, AUTO_TOP_MODEL };

export function isAuto(modelId: string): boolean {
  return modelId === AUTO_MODEL_ID;
}

// The real model id behind the selection: in Auto mode, the worker.
export function workingModelId(modelId: string): string {
  return isAuto(modelId) ? AUTO_WORKER_MODEL : modelId;
}

// If the cheap model's tool actions keep failing, the expert takes over for the
// rest of that job: two failures within the last three steps. A person saying no
// to a permission is not a failure.
export function shouldTakeOver(stepFailures: number[]): boolean {
  return stepFailures.slice(-3).reduce((sum, failures) => sum + failures, 0) >= 2;
}

export { countToolFailures } from '../providers/step-control.js';

export const EXPERT_INSTRUCTIONS = `You are the expert adviser to an assistant doing a job on a computer for someone with no technical background. You see the conversation so far, including every tool action and its result, then the assistant's question.
Reply with specific, practical guidance: the approach to take, what to check, and any mistake you can see. Name exact files, commands, or facts where you can. Keep it under 200 words.
Never guess: if the conversation does not show something, say it needs checking.
If the assistant is clearly out of its depth, begin your reply with the words TAKE OVER.`;

export const AUTO_NOTE = `

Your Expert

You can consult a stronger expert with askExpert. It sees this whole conversation. Consult it:
- before starting a job that changes more than one file, or needs a plan;
- when the same error has happened twice;
- before telling {{ADDRESS}} that a job with several steps is finished - say what you did and how you checked it.
Do not consult it for conversation, simple questions, or one small change. It costs far more than your own work, so ask one clear question.`;

// A readable copy of the conversation for the expert. Long tool results are
// shortened - the expert needs the shape of what happened, not every byte.
export function conversationForExpert(messages: ModelMessage[], maxChars = 80_000, perResult = 2_000): string {
  const lines: string[] = [];
  for (const message of messages) {
    if (typeof message.content === 'string') {
      lines.push(`${message.role.toUpperCase()}: ${message.content}`);
      continue;
    }
    for (const part of message.content as { type: string; [key: string]: unknown }[]) {
      if (part.type === 'text') lines.push(`${message.role.toUpperCase()}: ${String(part.text)}`);
      else if (part.type === 'tool-call') lines.push(`ACTION ${String(part.toolName)}: ${JSON.stringify(part.input)}`);
      else if (part.type === 'tool-result') {
        const output = part.output as { value?: unknown } | undefined;
        const value = typeof output?.value === 'string' ? output.value : JSON.stringify(output?.value ?? '');
        lines.push(`RESULT ${String(part.toolName)}: ${value.length > perResult ? value.slice(0, perResult) + ' …[shortened]' : value}`);
      }
    }
  }
  const text = lines.join('\n');
  return text.length > maxChars ? '…[earlier conversation shortened]\n' + text.slice(-maxChars) : text;
}

// Off until the owner chooses (17 Sept comparison): with Claude Sonnet 5 reviewing, the
// hard calculator job went from 2 of 5 to 2 of 2, but each job cost about $0.05 and
// took 5-7 minutes; a DeepSeek V4 Pro reviewer broke a job the cheap model gets right.
export const REVIEW_FINISHED_JOBS = process.env.JEEVES_REVIEW === '1';

export const REVIEW_INSTRUCTIONS = `You are the expert reviewer for an assistant doing a job on a computer for someone with no technical background. The assistant believes the job is finished. You see the whole conversation: the request, every action, every file written, and every result.
Check the work against what the person asked for - including cases the request clearly implies but does not list.
If nothing is wrong, reply with exactly: OK
Otherwise reply with a short numbered list of the concrete problems, each saying what input or situation goes wrong and what should happen instead. Do not rewrite the work yourself. Never guess: only report problems the conversation shows.`;

// The compulsory final check: when Auto changed files, the expert reviews the work
// before the person is told it is done. In testing the cheap model never chose to
// consult before finishing, so this is not left to its judgement.
export async function reviewFinishedJob(messages: ModelMessage[], expertModel = AUTO_EXPERT_MODEL): Promise<{ ok: boolean; advice: string } | null> {
  const key = getOpenRouterKey();
  if (!key) return null;
  const lineId = session.addToolLine('askExpert', 'final check of the work', 'running');
  session.setActiveModel(expertModel);
  try {
    const reply = await openrouterChat(key, {
      model: expertModel,
      messages: [
        { role: 'system', content: REVIEW_INSTRUCTIONS },
        { role: 'user', content: `Conversation:\n${conversationForExpert(messages, 80_000, 6_000)}` },
      ],
      max_tokens: 1500,
    });
    const ok = /^\s*OK\s*\.?\s*$/i.test(reply.text);
    session.updateToolLine(lineId, { state: 'done', label: ok ? 'Expert checked the work' : 'Expert found something to fix' });
    return { ok, advice: reply.text };
  } catch {
    session.updateToolLine(lineId, { state: 'failed', label: 'the expert was not available' });
    return null;
  } finally {
    session.setActiveModel(AUTO_WORKER_MODEL);
  }
}

export interface AutoTurnState {
  expertTookOver: boolean;
  // The step at which the expert took over (-1 until then), so later failures are
  // counted from there.
  takeoverStep: number;
  // Whether the person was already asked about the strongest model on this job.
  askedAboutTop: boolean;
  onTopModel: boolean;
}

export function newAutoTurnState(): AutoTurnState {
  return { expertTookOver: false, takeoverStep: -1, askedAboutTop: false, onTopModel: false };
}

// How many times the expert's price the strongest model costs, from the catalogue
// (input prices); null when either is missing.
export function topModelPriceRatio(models: { id: string; promptPrice: number }[]): number | null {
  const expert = models.find((model) => model.id === AUTO_EXPERT_MODEL);
  const top = models.find((model) => model.id === AUTO_TOP_MODEL);
  if (!expert || !top || expert.promptPrice <= 0) return null;
  return top.promptPrice / expert.promptPrice;
}

export function topModelQuestion(address: string, ratio: number | null): string {
  const cost = ratio ? ` It costs about ${Number(ratio.toFixed(1))}× as much as the expert.` : '';
  return `This is proving difficult, ${address}. Shall I try the strongest model (Claude Opus 5) for this job?${cost} (y/n)`;
}

export function createAskExpertTool(state: AutoTurnState, expertModel = AUTO_EXPERT_MODEL) {
  return tool({
    description:
      'Consult a stronger expert model about the job in hand. It sees the whole conversation. Use at decision points only (see the rules).',
    inputSchema: z.object({ question: z.string().min(1).describe('One clear question for the expert') }),
    execute: async ({ question }, { messages }) => {
      const key = getOpenRouterKey();
      if (!key) return 'The expert is not available: it needs an OpenRouter key.';
      const lineId = session.addToolLine('askExpert', question.slice(0, 60), 'running');
      session.setActiveModel(expertModel);
      try {
        const reply = await openrouterChat(key, {
          model: expertModel,
          messages: [
            { role: 'system', content: EXPERT_INSTRUCTIONS },
            { role: 'user', content: `Conversation so far:\n${conversationForExpert(messages)}\n\nThe assistant asks: ${question}` },
          ],
          max_tokens: 1500,
        });
        if (reply.text.trimStart().toUpperCase().startsWith('TAKE OVER')) state.expertTookOver = true;
        session.updateToolLine(lineId, { state: 'done', label: 'Checked with the expert' });
        return reply.text || 'The expert had no advice to add.';
      } catch (error) {
        session.updateToolLine(lineId, { state: 'failed', label: 'the expert was not available' });
        return `The expert could not be reached (${error instanceof Error ? error.message : String(error)}). Carry on carefully.`;
      } finally {
        session.setActiveModel(state.expertTookOver ? expertModel : AUTO_WORKER_MODEL);
      }
    },
  });
}
