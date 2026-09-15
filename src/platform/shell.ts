import { platform } from 'node:os';

export interface ShellSpec {
  program: string;
  flag: string;
}

// Assumption per spec: bash on macOS and Linux, PowerShell on Windows; Windows is verified in Phase 8.
export function getShell(): ShellSpec {
  if (platform() === 'win32') {
    return { program: 'powershell.exe', flag: '-Command' };
  }
  return { program: 'bash', flag: '-c' };
}