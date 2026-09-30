import path from 'node:path';
import { session } from '../state/session.js';
import { toggleVerbose } from './verbose.js';
import { openModelPicker } from './model.js';
import { clearConversation } from './clear.js';
import { openAddressPrompt } from './address.js';
import { togglePlanMode } from '../agent/plan.js';
import { untrustProject, untrustCommandFamilies } from '../agent/trust.js';
import { undoLastChange } from '../checkpoints/index.js';
import { copyLastAnswer, saveConversationFile } from './export.js';
import { displayPath } from '../platform/paths.js';

// ONE list of everything Jeeves can be told to do by name. Settings, Help, the desktop window and
// the typed commands all read this list, so a new command is written once (Claude Code keeps one
// small object per command - name, description, handler - in a registry, and OpenCode a registry of
// command records; before this, each command was written out in four places here).
export interface CommandSpec {
  command: string;
  // The plain name on Settings' buttons - never the typed command.
  label?: string;
  description: string;
  // Where Settings lists it as a button: the top "Conversation" section, or "More". Absent: not listed
  // (it has its own place there).
  place?: 'conversation' | 'more';
  // What the desktop window itself does for this command (the rest are run by the engine).
  window?: 'settings' | 'help' | 'folder' | 'exit';
  run: () => void | Promise<void>;
}

async function undo(): Promise<void> {
  if (session.status === 'working') {
    session.addNotice('Undo works between tasks - wait for this one to finish, then click Settings, then Undo last change.');
    return;
  }
  try {
    const outcome = await undoLastChange();
    session.addNotice(outcome.message);
    if (outcome.historyNote) session.pendingContextNote = outcome.historyNote;
  } catch (error) {
    session.addError("Undo didn't work this time - nothing was changed. Please try again from Settings, then Undo last change.");
    if (session.verbose) session.addNotice(`Technical details: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export const COMMAND_TABLE: CommandSpec[] = [
  { command: '/settings', window: 'settings', description: 'everything in one place - folders, AI service, keys, and more (or click Settings at the bottom)', run: () => session.openSettings() },
  { command: '/help', label: 'Help', place: 'more', window: 'help', description: 'what I can do', run: () => session.openHelp() },
  { command: '/model', window: 'settings', description: 'choose the AI service and model', run: () => openModelPicker() },
  { command: '/keys', window: 'settings', description: 'connect an AI service, or remove one', run: () => session.openKeys() },
  { command: '/folder', window: 'folder', description: 'work in a different folder, or just chat', run: () => session.openFolderPicker() },
  { command: '/clear', label: 'New conversation', place: 'conversation', description: 'start fresh - this one stays saved', run: () => {
      clearConversation();
      session.addNotice('Started a fresh conversation - the earlier one stays saved.');
    } },
  { command: '/plan', label: 'Plan first', place: 'conversation', description: 'on or off - I show my plan and wait for your yes', run: () => session.addNotice(togglePlanMode()) },
  { command: '/copy', label: 'Copy last answer', place: 'conversation', description: 'copy my last answer so you can paste it', run: copyLastAnswer },
  { command: '/save', label: 'Save conversation as a document', place: 'conversation', description: 'a text file in this folder', run: () => {
      try {
        const file = saveConversationFile();
        session.addNotice(file ? `Saved as "${path.basename(file)}" in ${displayPath(path.dirname(file))}.` : "There's nothing to save yet - say something first.");
      } catch {
        session.addNotice("The conversation couldn't be saved here - the folder may not allow new files.");
      }
    } },
  { command: '/undo', label: 'Undo last change', place: 'conversation', description: 'put the folder back to how it was', run: undo },
  { command: '/ask', label: 'Ask before changes', place: 'more', description: 'ask before every change again', run: () => {
      untrustCommandFamilies();
      session.addNotice(
        untrustProject()
          ? "I'll ask before every change in this project folder again."
          : 'I already ask before every change in this project folder.'
      );
    } },
  { command: '/address', label: 'How I address you', window: 'settings', description: 'change how Jeeves addresses you', run: () => openAddressPrompt() },
  { command: '/verbose', label: 'Show every step', place: 'more', description: 'show every step, for the curious', run: () => session.addNotice(toggleVerbose()) },
  { command: '/exit', label: 'Quit', place: 'more', window: 'exit', description: 'quit', run: () => session.requestExit() },
];

// A typed "/something": run it, or say plainly it is not known. Returns false when the text is not a
// command at all (an ordinary message that happens to start with a slash-less word, or "/ ...").
export async function runCommand(input: string): Promise<boolean> {
  if (!(input.startsWith('/') && input.length > 1 && !input.startsWith('/ '))) return false;
  const spec = COMMAND_TABLE.find((entry) => entry.command === input);
  if (spec) await spec.run();
  else session.addNotice("I don't know that command - click Settings to see everything I can do.");
  return true;
}
