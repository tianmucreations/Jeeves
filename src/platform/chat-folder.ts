import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// "Just chat": no project needed. Jeeves still works in a folder of its own, so
// anything it is asked to save lands somewhere the person can find, /undo still
// works, and nothing ever runs loose in the whole home folder (agreed 19 Sept).
export const CHAT_FOLDER_NAME = 'Jeeves Chats';

export function chatFolder(): string {
  return path.join(os.homedir(), 'Documents', CHAT_FOLDER_NAME);
}

// Creates the folder when needed; the location, or null if it could not be made.
export function ensureChatFolder(): string | null {
  const folder = chatFolder();
  try {
    mkdirSync(folder, { recursive: true });
    return folder;
  } catch {
    return null;
  }
}

export function chatNotice(address: string): string {
  return `Just chatting, ${address} - anything I save for you goes in Documents/${CHAT_FOLDER_NAME}. Type /folder any time to work in a folder instead.`;
}
