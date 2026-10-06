import { session } from '../state/session.js';
import { setRecentProjects, getAddress } from '../platform/config.js';
import { displayPath } from '../platform/paths.js';
import { chatNotice } from '../platform/chat-folder.js';

// Moves Jeeves into a folder - the folder list and Settings both come through here,
// so they can never disagree. remember: false for the chat folder, which is not a
// project and never joins the recent list. Returns whether this was a switch from
// inside a conversation (rather than the first choice at launch).
export function enterFolder(folder: string, remember = true): boolean {
  try {
    process.chdir(folder);
  } catch {
    // Staying in the current folder is the safe fallback.
  }
  if (remember) {
    const updated = [folder, ...session.recentProjects.filter((p) => p !== folder)].slice(0, 10);
    session.setRecentProjects(updated);
    setRecentProjects(updated);
  }
  const switching = session.switchingFolder;
  session.launchComplete();
  session.addNotice(remember ? `Now working in ${displayPath(folder)}.` : chatNotice(getAddress() ?? 'Sir'));
  if (switching) {
    // The conversation carries on in the new folder; the model is told it moved.
    session.pendingContextNote = `[The person moved Jeeves to ${remember ? `the folder ${folder}` : `the chat folder ${folder}`}. Files mentioned earlier may not be here - look again before relying on them.]`;
  }
  return switching;
}
