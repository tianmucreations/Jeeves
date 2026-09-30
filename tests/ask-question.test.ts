import { describe, it, expect } from 'vitest';
import { askQuestion, answerOption, answerQuestion, cancelQuestion, questionOpen, questionPanelLines } from '../src/agent/question.js';
import { TOOLS } from '../src/tools/index.js';
import { session } from '../src/state/session.js';
import { stopTurn } from '../src/agent/loop.js';

const input = { question: 'Which folder?', options: [{ label: 'Documents (Recommended)', description: 'easy to find' }, { label: 'Desktop' }] };

describe('question with choices (Claude Code AskUserQuestion / OpenCode question)', () => {
  it('waits, then a choice answers it and the panel clears', async () => {
    const waiting = askQuestion(input);
    expect(questionOpen()).toBe(true);
    expect(session.question?.options).toHaveLength(2);
    expect(answerOption(1)).toBe(true);
    expect(await waiting).toBe('Desktop');
    expect(session.question).toBeNull();
    expect(answerOption(0)).toBe(false);
  });
  it('typed words are an answer too, and stopping the job answers with nothing', async () => {
    const typed = askQuestion(input);
    answerQuestion('my own idea');
    expect(await typed).toBe('my own idea');
    const stopped = askQuestion(input);
    cancelQuestion();
    expect(await stopped).toBe('');
  });
  it('as a tool it returns the answer to the model, and a stopped question says so', async () => {
    const call = TOOLS.askQuestion.execute!(input, { toolCallId: 't', messages: [] } as never);
    for (let i = 0; i < 100 && !questionOpen(); i++) await new Promise((r) => setTimeout(r, 5));
    answerOption(0);
    expect(await call).toBe('Documents (Recommended)');
    const second = TOOLS.askQuestion.execute!(input, { toolCallId: 't2', messages: [] } as never);
    for (let i = 0; i < 100 && !questionOpen(); i++) await new Promise((r) => setTimeout(r, 5));
    cancelQuestion();
    expect(String(await second)).toContain('did not answer');
    void stopTurn;
  });
  it('lays out the panel: the question, numbered choices, one line of how to answer', () => {
    const lines = questionPanelLines({ ...input, highlight: 0 }, 60);
    expect(lines.map((l) => l.text)).toEqual(['Which folder?', '1  Documents (Recommended) - easy to find', '2  Desktop', 'Click one, press its number, or type your own answer and press Enter']);
    expect(lines.filter((l) => l.option !== undefined)).toHaveLength(2);
  });
});
