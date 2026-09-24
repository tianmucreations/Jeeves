import { describe, it, expect } from 'vitest';
import { describeCommand, describeDone } from '../src/tools/describe.js';
import { plainToolFailure } from '../src/tools/index.js';
import { toolLineText } from '../src/components/transcript-layout.js';
import { PlainError } from '../src/tools/plain.js';

// The owner's report, 24 Sept: "Run mkdir -p ~/Documents/projects/test && ls -d
// ~/Documents/pro… — allow?" looked "shocking and confusing" - raw commands and
// flags where Claude Code and OpenCode show a question a person can read.
describe('commands are named in plain English on the question line', () => {
  it('names the common file and folder actions', () => {
    expect(describeCommand('mkdir test')).toBe('Create folder test');
    expect(describeCommand('mkdir -p ~/Documents/projects/test')).toBe('Create folder ~/Documents/projects/test');
    expect(describeCommand('mkdir "my folder"')).toBe('Create folder my folder');
    expect(describeCommand('mkdir -p a b c')).toBe('Create folder a, b, c');
    expect(describeCommand('rm -rf build')).toBe('Delete build');
    expect(describeCommand('rmdir empty-folder')).toBe('Delete folder empty-folder');
    expect(describeCommand('touch notes.txt')).toBe('Create file notes.txt');
    expect(describeCommand('cp a.txt b.txt')).toBe('Copy a.txt to b.txt');
    expect(describeCommand('mv old.txt new.txt')).toBe('Move old.txt to new.txt');
  });

  it('describes the change a compound command makes, not the checking it appends', () => {
    expect(describeCommand('mkdir -p ~/Documents/projects/test && ls -d ~/Documents/projects/test')).toBe(
      'Create folder ~/Documents/projects/test'
    );
    expect(describeCommand('ls && mkdir test')).toBe('Create folder test');
  });

  it('keeps the raw command when nothing common matches - the question never lies', () => {
    expect(describeCommand('git push origin main')).toBe('git push origin main');
    expect(describeCommand('echo "$HOME"; ls "$HOME"')).toBe('echo "$HOME"; ls "$HOME"');
  });

  it('the record line afterwards speaks the same words', () => {
    expect(describeDone('mkdir -p ~/Documents/projects/test')).toBe('Created folder ~/Documents/projects/test');
    expect(describeDone('rm -rf build')).toBe('Deleted build');
    expect(describeDone('mv old.txt new.txt')).toBe('Moved old.txt to new.txt');
    expect(describeDone('git push origin main')).toBe('Ran git push origin main');
  });

  it('the runBash question line is the action itself, with no tool name and no (y/n)', () => {
    const line = toolLineText({ tool: 'runBash', summary: 'Create folder test', state: 'awaiting', label: '' });
    expect(line.text).toBe('? Create folder test — allow?');
    const done = toolLineText({ tool: 'runBash', summary: 'Create folder test', state: 'done', label: 'Created folder test' });
    expect(done.text).toBe('✓ Created folder test');
  });

  it('other tools keep their names on the line', () => {
    const line = toolLineText({ tool: 'readFile', summary: 'notes.txt', state: 'awaiting', label: '' });
    expect(line.text).toBe('? Read notes.txt — allow?');
  });
});

// The Desktop showed "List failed: something unexpected went wrong" for an
// error the tool had already worded plainly.
describe('plain errors pass through untouched', () => {
  it('a PlainError reaches the screen as written', () => {
    expect(plainToolFailure(new PlainError('That folder does not exist.'))).toBe('That folder does not exist.');
  });

  it('a folder that does not exist never reads as "something unexpected"', () => {
    expect(plainToolFailure(new Error('ENOENT: no such file or directory, scandir'))).not.toContain('unexpected');
  });
});
