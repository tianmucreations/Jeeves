// An app opened from the Dock or Finder does not get the terminal's settings, so
// commands Jeeves runs could not find programs such as node or python. Copied from
// OpenCode Desktop (packages/desktop/src/main/shell-env.ts, MIT): ask the person's
// own shell for its environment once, at start-up, with a 5-second limit, and fall
// back to the app's own environment if that fails.
import { spawnSync } from 'node:child_process';
import { userInfo } from 'node:os';

const TIMEOUT = 5_000;

function userShell() {
  try {
    return process.env.SHELL || userInfo().shell || '/bin/sh';
  } catch {
    return process.env.SHELL || '/bin/sh';
  }
}

function probe(shell, mode) {
  const out = spawnSync(shell, [mode, '-c', 'env -0'], { stdio: ['ignore', 'pipe', 'ignore'], timeout: TIMEOUT });
  if (out.error || out.status !== 0) return out.error?.code === 'ETIMEDOUT' ? 'timeout' : null;
  const env = {};
  for (const line of out.stdout.toString('utf8').split('\0')) {
    const at = line.indexOf('=');
    if (at > 0) env[line.slice(0, at)] = line.slice(at + 1);
  }
  return Object.keys(env).length > 0 ? env : null;
}

// Fills in what the app is missing; the shell's PATH wins, since the app's own is
// the bare system one.
export function loadShellEnv() {
  if (process.platform === 'win32') return false;
  const shell = userShell();
  let env = probe(shell, '-il');
  if (env === 'timeout') return false;
  if (!env) env = probe(shell, '-l');
  if (!env || env === 'timeout') return false;
  for (const [key, value] of Object.entries(env)) {
    if (key === 'PATH' || process.env[key] === undefined) process.env[key] = value;
  }
  return true;
}
