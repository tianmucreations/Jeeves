import { z } from 'zod';
import { addNote, removeNote, allNotes } from '../platform/memory.js';

// Remembering and forgetting, for the model to use when the person asks, or states something lasting.
export const memorySchema = z.object({
  action: z.enum(['remember', 'forget', 'list']),
  note: z.string().optional().describe('One short sentence to keep, or the words of the note to forget'),
  about: z.enum(['me', 'this folder']).optional().describe('me: the person anywhere; this folder: this job'),
});

export function runMemory(input: z.output<typeof memorySchema>): string {
  if (input.action === 'list') {
    const notes = allNotes();
    return notes.length === 0 ? 'Nothing is remembered yet.' : notes.map((n) => `- (${n.about}) ${n.text}`).join('\n');
  }
  if (!input.note?.trim()) return 'Say which note (the words to remember or to forget).';
  if (input.action === 'forget') {
    const gone = removeNote(input.note);
    return gone ? `Forgot: ${gone.text}` : 'No remembered note matches that.';
  }
  const result = addNote(input.about === 'this folder' ? 'folder' : 'me', input.note);
  return result === 'added' ? `Remembered: ${input.note.trim()}` : result === 'duplicate' ? 'Already remembered.' : result === 'full' ? 'The memory is full - forget something first.' : 'Nothing to remember.';
}
