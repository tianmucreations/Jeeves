import { realpathSync } from 'node:fs';
import { getTrustedProjects, setTrustedProjects } from '../platform/config.js';

// "Always allow in this project" (after Claude Code's "Yes, allow all edits in this
// folder during this session" - here remembered per project folder, as asked for).
// It covers changes inside the project folder only: anything outside it, or a
// command that may reach outside it, still asks. Every change is still backed up
// first, so /undo can put it back.

function canonical(folder: string): string {
  try {
    return realpathSync(folder);
  } catch {
    return folder;
  }
}

export function isProjectTrusted(folder = process.cwd()): boolean {
  return getTrustedProjects().includes(canonical(folder));
}

export function trustProject(folder = process.cwd()): void {
  const key = canonical(folder);
  if (!getTrustedProjects().includes(key)) setTrustedProjects([...getTrustedProjects(), key]);
}

export function untrustProject(folder = process.cwd()): boolean {
  const key = canonical(folder);
  const before = getTrustedProjects();
  setTrustedProjects(before.filter((entry) => entry !== key));
  return before.includes(key);
}
