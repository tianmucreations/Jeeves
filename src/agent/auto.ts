import { tool, type ModelMessage } from 'ai';
import { z } from 'zod';
import { session } from '../state/session.js';
import { expertChat } from './expert-chat.js';
import { seenModels } from '../providers/catalogue.js';
import type { ModelInfo } from '../models/registry.js';

// Auto mode: a cheap worker with an expert on call - the pattern Claude Code
// publishes as its "advisor" (code.claude.com/docs/en/advisor): the main model does
// the routine work and consults a stronger model at decision points (before
// committing to an approach, when an error keeps recurring, before declaring a task
// done), which costs less than running the stronger model throughout. No guessing
// whether a message is "chat" or "work": the cheap model is always first.

import { AUTO_MODEL_ID, AUTO_WORKER_MODEL, AUTO_PROFILES, autoProfile, firstAvailable, type AutoProfile } from './auto-ids.js';
export { AUTO_MODEL_ID, AUTO_WORKER_MODEL };

// Auto runs on OpenRouter and on the services with a profile in auto-ids.ts (OpenAI).
export function hasAuto(providerId: string): boolean {
  return autoProfile(providerId) !== null;
}

// The model list Auto chooses from: OpenRouter's catalogue, or the models a company's
// key can use (loaded when the company is chosen, and at startup).
export function autoCatalogue(providerId = session.providerId): ModelInfo[] {
  return providerId === 'openrouter' ? session.models : seenModels(providerId);
}

// A service without Auto falls back to OpenRouter's choices (used by web research).
function profileFor(providerId: string): { profile: AutoProfile; catalogue: ModelInfo[] } {
  const profile = autoProfile(providerId);
  return profile ? { profile, catalogue: autoCatalogue(providerId) } : { profile: AUTO_PROFILES.openrouter, catalogue: session.models };
}

// The models Auto uses right now, allowing for retired models (see auto-ids.ts).
export function workerModel(providerId = session.providerId): string {
  const { profile, catalogue } = profileFor(providerId);
  return firstAvailable(profile.workers, catalogue) ?? profile.workers[0] ?? AUTO_WORKER_MODEL;
}

export function expertModel(providerId = session.providerId): string | null {
  const { profile, catalogue } = profileFor(providerId);
  return firstAvailable(profile.experts, catalogue);
}

export function topModel(providerId = session.providerId): string | null {
  const { profile, catalogue } = profileFor(providerId);
  return firstAvailable(profile.top, catalogue);
}

// Where Auto is offered, by name, for the note in lists without it.
export const AUTO_SERVICE_NAMES: Record<string, string> = { openrouter: 'OpenRouter', openai: 'OpenAI', google: 'Google' };

// Jeeves only offers Auto where a pairing was proven to do good work (the project's
// core principle: Jeeves's name carries the blame - docs/SPECIFICATION.md). Elsewhere, one plain line says so.
export function noAutoNote(providerId: string, label: string): string | null {
  if (hasAuto(providerId)) return null;
  const names = Object.keys(AUTO_PROFILES).map((id) => AUTO_SERVICE_NAMES[id] ?? id);
  const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
  return `Auto isn't available with ${label} yet - choose ${list} for Auto.`;
}

// The Auto row in a company's model list, when it has Auto and its worker is available.
export function autoRowFor(providerId: string, models: ModelInfo[]): ModelInfo | null {
  const profile = autoProfile(providerId);
  if (!profile || providerId === 'openrouter') return null;
  const workerId = firstAvailable(profile.workers, models);
  const worker = models.find((model) => model.id === workerId);
  return worker ? { ...worker, id: AUTO_MODEL_ID, name: 'Auto', priceLabel: 'cheap, expert when needed' } : null;
}

export function isAuto(modelId: string): boolean {
  return modelId === AUTO_MODEL_ID;
}

// The real model id behind the selection: in Auto mode, the worker.
export function workingModelId(modelId: string): string {
  return isAuto(modelId) ? workerModel() : modelId;
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

// On in Auto mode (decided 18 Sept): Auto must be excellent without anyone
// having to think about models. Targeted to programs and documents (review.ts), it
// rescued 2 of 3 letters and cost 0.2-2.5 cents per checked job. JEEVES_REVIEW=0 turns
// it off for testing.
export const REVIEW_FINISHED_JOBS = process.env.JEEVES_REVIEW !== '0';

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
export function topModelPriceRatio(
  models: { id: string; promptPrice: number }[],
  expertId: string | null = expertModel(),
  topId: string | null = topModel()
): number | null {
  const expert = models.find((model) => model.id === expertId);
  const top = models.find((model) => model.id === topId);
  if (!expert || !top || expert.promptPrice <= 0) return null;
  return top.promptPrice / expert.promptPrice;
}

export function topModelQuestion(address: string, ratio: number | null, name = topModelName()): string {
  const cost = ratio ? ` It costs about ${Number(ratio.toFixed(1))}× as much as the expert.` : '';
  return `This is proving difficult, ${address}. Shall I try the strongest model (${name}) for this job?${cost} (y/n)`;
}

// The strongest model's everyday name ("Claude Opus 5"), from the catalogue.
export function topModelName(providerId = session.providerId): string {
  const id = topModel(providerId);
  const found = autoCatalogue(providerId).find((model) => model.id === id);
  if (found) return found.name.replace(/^[A-Za-z][A-Za-z0-9 .-]*: /, '');
  return id ? readableModelName(id) : 'the strongest model';
}

// "anthropic/claude-opus-5" -> "Claude Opus 5", "gpt-5.6-sol" -> "GPT 5.6 Sol", for
// when the catalogue has not loaded.
export function readableModelName(id: string): string {
  return (id.split('/').pop() ?? id)
    .split('-')
    .map((word) => (word === 'gpt' ? 'GPT' : word.charAt(0).toUpperCase() + word.slice(1)))
    .join(' ');
}

export function createAskExpertTool(state: AutoTurnState) {
  return tool({
    description:
      'Consult a stronger expert model about the job in hand. It sees the whole conversation. Use at decision points only (see the rules).',
    inputSchema: z.object({ question: z.string().min(1).describe('One clear question for the expert') }),
    execute: async ({ question }, { messages }) => {
      const expert = expertModel();
      if (!expert) return 'No expert model is available right now. Carry on carefully, and tell the person the work could not be double-checked.';
      const lineId = session.addToolLine('askExpert', question.slice(0, 60), 'running');
      session.setActiveModel(expert);
      try {
        const reply = await expertChat(
          expert,
          [
            { role: 'system', content: EXPERT_INSTRUCTIONS },
            { role: 'user', content: `Conversation so far:\n${conversationForExpert(messages)}\n\nThe assistant asks: ${question}` },
          ],
          1500
        );
        if (reply.trimStart().toUpperCase().startsWith('TAKE OVER')) state.expertTookOver = true;
        session.updateToolLine(lineId, { state: 'done', label: 'Checked with the expert' });
        return reply || 'The expert had no advice to add.';
      } catch (error) {
        session.updateToolLine(lineId, { state: 'failed', label: 'the expert was not available' });
        return `The expert could not be reached (${error instanceof Error ? error.message : String(error)}). Carry on carefully.`;
      } finally {
        session.setActiveModel(state.expertTookOver ? expert : workerModel());
      }
    },
  });
}
