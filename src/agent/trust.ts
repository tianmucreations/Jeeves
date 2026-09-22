import { realpathSync } from 'node:fs';
import path from 'node:path';
import { getTrustedProjects, setTrustedProjects } from '../platform/config.js';
import { isOutsideProject, commandMayReachOutside } from '../checkpoints/index.js';

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

// The same canonical form as trustProject stores a folder in, but for a path that
// may not exist yet (a new file, or a folder still being created) - resolved as
// far up the tree as does exist, then the rest rejoined unchanged. Without this,
// a trusted folder reached through a symlinked parent (macOS's /tmp -> /private/tmp
// is the common case) would never match, because the stored folder is the real
// path but the path being checked is not.
function canonicalPath(target: string): string {
  const absolute = path.resolve(target);
  try {
    return realpathSync(absolute);
  } catch {
    const parent = path.dirname(absolute);
    if (parent === absolute) return absolute;
    return path.join(canonicalPath(parent), path.basename(absolute));
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

// A task that spans more than one of the owner's own project folders used to ask
// every single time it touched the second one, even after "always allow" had been
// said there directly - "always allow" only ever covered the one active folder.
// These answer "is this already covered by a folder Jeeves has been trusted in
// before", for a path or a command, regardless of which folder is active right
// now - so once a folder has been trusted once (by working in it and saying
// "always allow"), reaching into it from elsewhere is silent from then on. A
// command is only ever counted as covered when it stays entirely within one
// trusted folder - the same conservative path-extraction already used for the
// single-folder case, just checked against every trusted folder in turn.
export function isPathTrusted(target: string): boolean {
  const resolved = canonicalPath(target);
  return getTrustedProjects().some((folder) => !isOutsideProject(resolved, folder));
}

export function isCommandTrusted(command: string): boolean {
  return getTrustedProjects().some((folder) => !commandMayReachOutside(command, folder));
}
