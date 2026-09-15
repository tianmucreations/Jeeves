import process from 'node:process';

export interface ShellSpec {
  program: string;
  flag: string;
}

// bash on macOS and Linux, PowerShell on Windows, chosen from process.platform
// (spec Phase 8). execa resolves the program through PATH on every platform.
export function getShell(platform: NodeJS.Platform = process.platform): ShellSpec {
  if (platform === 'win32') {
    return { program: 'powershell.exe', flag: '-Command' };
  }
  return { program: 'bash', flag: '-c' };
}