import { z } from 'zod';
import { session } from '../state/session.js';

// Asking the person to choose, as Claude Code's AskUserQuestion and OpenCode's question
// tool: two to four options as buttons, and always the way to type an answer of their
// own. The model waits for the answer, then carries on with it.
export const askQuestionSchema = z.object({
  question: z.string().min(1),
  options: z
    .array(z.object({ label: z.string().min(1), description: z.string().optional() }))
    .min(2)
    .max(4)
    .describe('Your recommended choice first, its label ending "(Recommended)". No "Other": typing is always offered.'),
});

// One question on screen at a time, and a QUEUE behind it (the race fix, 3 Oct):
// two tool calls asking at once used to overwrite each other, leaving the first
// job's promise hanging forever and the job wedged until Esc. Now the second
// question waits its turn, and Stop/Esc cancels the whole queue.
let pending: ((answer: string) => void) | null = null;
let waiting: { input: z.output<typeof askQuestionSchema>; resolve: (answer: string) => void }[] = [];

export function questionOpen(): boolean {
  return pending !== null;
}

function display(input: z.output<typeof askQuestionSchema>, resolve: (answer: string) => void): void {
  pending = resolve;
  session.setQuestion({ question: input.question, options: input.options, highlight: 0 });
}

export function askQuestion(input: z.output<typeof askQuestionSchema>): Promise<string> {
  if (pending === null) return new Promise((resolve) => display(input, resolve));
  return new Promise((resolve) => waiting.push({ input, resolve }));
}

// A button, a number, or typed words: all land here.
export function answerQuestion(answer: string): void {
  const resolve = pending;
  if (!resolve) return;
  const next = waiting.shift();
  if (next) {
    // The queued question becomes the one on screen; nothing hangs.
    display(next.input, next.resolve);
  } else {
    pending = null;
    session.setQuestion(null);
  }
  resolve(answer);
}

// Stop / Esc: the job is over, so nobody is waiting for an answer - the one on
// screen AND any queued behind it, all released at once (nothing is promoted to
// the screen on a stop; the window goes quiet in one clean step).
export function cancelQuestion(): void {
  const current = pending;
  const rest = waiting.splice(0);
  pending = null;
  session.setQuestion(null);
  current?.('');
  for (const item of rest) item.resolve('');
}

export function answerOption(index: number): boolean {
  const option = session.question?.options[index];
  if (!option) return false;
  answerQuestion(option.label);
  return true;
}

// The lines the panel draws above the typing box: the question (wrapped to at most three
// rows), then a numbered row per choice, then one line saying how to answer.
export function questionPanelLines(question: NonNullable<typeof session.question>, width: number): { text: string; option?: number }[] {
  const words = question.question.split(/\s+/);
  const wrapped: string[] = [];
  let line = '';
  for (const word of words) {
    if (line && (line + ' ' + word).length > width) {
      wrapped.push(line);
      line = word;
    } else {
      line = line ? `${line} ${word}` : word;
    }
  }
  if (line) wrapped.push(line);
  const asked = wrapped.slice(0, 3).map((text, i, all) => ({ text: i === 2 && wrapped.length > 3 && all.length === 3 ? text.slice(0, Math.max(0, width - 1)) + '…' : text }));
  const options = question.options.map((option, index) => ({
    text: `${index + 1}  ${option.label}${option.description ? ` - ${option.description}` : ''}`,
    option: index,
  }));
  return [...asked, ...options, { text: 'Click one, press its number, or type your own answer and press Enter' }];
}
