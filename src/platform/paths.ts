import path from 'node:path';

// Path helpers. Resolving against the current folder keeps behaviour identical on macOS, Windows, and Linux.
export function resolveFromCwd(p: string): string {
  return path.resolve(p);
}