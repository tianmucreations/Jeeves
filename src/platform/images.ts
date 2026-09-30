import { execFile, spawn } from 'node:child_process';
import { readFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { platform, release, tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

// Pictures in a message, as OpenCode and Claude Code take them: paste one from the
// clipboard (a screenshot), or drop a picture file onto the window (the terminal types
// its address). The clipboard reading is OpenCode's (packages/tui/src/clipboard.ts):
// osascript on a Mac, PowerShell on Windows, wl-paste or xclip on Linux.
const exec = promisify(execFile);

export interface ImageAttachment {
  name: string;
  mediaType: string;
  // The picture itself, as base64 text (what the AI libraries take and what saves as JSON).
  data: string;
}

// The most Jeeves will send in one picture. Anthropic's limit is 5 MB; other services allow
// more, so this is the lowest common one, told plainly when a picture is over it.
export const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const TYPES: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

function run(command: string, args: string[]): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
    const out: Buffer[] = [];
    child.on('error', reject);
    child.stdout?.on('data', (chunk: Buffer) => out.push(chunk));
    child.on('close', (code) => (code === 0 ? resolve(Buffer.concat(out)) : reject(new Error(`${command} exited with ${code}`))));
  });
}

// A picture on the clipboard (a screenshot, "copy image"), or null.
export async function readClipboardImage(): Promise<ImageAttachment | null> {
  const found = (data: string): ImageAttachment => ({ name: 'pasted picture', mediaType: 'image/png', data });
  if (platform() === 'darwin') {
    const file = path.join(tmpdir(), `jeeves-clipboard-${process.pid}.png`);
    try {
      await exec('osascript', [
        '-e', 'set imageData to the clipboard as "PNGf"',
        '-e', `set fileRef to open for access POSIX file "${file}" with write permission`,
        '-e', 'set eof fileRef to 0',
        '-e', 'write imageData to fileRef',
        '-e', 'close access fileRef',
      ]);
      const bytes = await readFile(file);
      if (bytes.length > 0) return found(bytes.toString('base64'));
    } catch {
      // No picture on the clipboard.
    } finally {
      await rm(file, { force: true }).catch(() => {});
    }
    return null;
  }
  if (platform() === 'win32' || release().includes('WSL')) {
    const script =
      'Add-Type -AssemblyName System.Windows.Forms; $img = [System.Windows.Forms.Clipboard]::GetImage(); if ($img) { $ms = New-Object System.IO.MemoryStream; $img.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png); [System.Convert]::ToBase64String($ms.ToArray()) }';
    const out = await run('powershell.exe', ['-NonInteractive', '-NoProfile', '-command', script]).catch(() => Buffer.alloc(0));
    if (out.length) return found(out.toString().trim());
  }
  if (platform() === 'linux') {
    const wayland = await run('wl-paste', ['-t', 'image/png']).catch(() => Buffer.alloc(0));
    if (wayland.length) return found(wayland.toString('base64'));
    const x11 = await run('xclip', ['-selection', 'clipboard', '-t', 'image/png', '-o']).catch(() => Buffer.alloc(0));
    if (x11.length) return found(x11.toString('base64'));
  }
  return null;
}

// One dropped or typed address: quotes, a file:// start and backslash-escaped spaces (how
// terminals write a dropped file) are tidied; a leading ~ is the home folder.
function tidyAddress(raw: string): string {
  let text = raw.trim();
  if ((text.startsWith("'") && text.endsWith("'")) || (text.startsWith('"') && text.endsWith('"'))) text = text.slice(1, -1);
  if (text.startsWith('file://')) {
    try {
      text = decodeURIComponent(new URL(text).pathname);
    } catch {
      text = text.slice(7);
    }
  }
  text = text.replace(/\\(.)/g, '$1');
  if (text === '~' || text.startsWith('~/')) text = path.join(homedir(), text.slice(1));
  return text;
}

// The addresses in some text that are pictures on this computer: a dropped file is one address;
// several dropped together come space-separated with escaped spaces.
export function imagePathsIn(text: string): string[] {
  const parts = text.match(/(?:\\.|[^\s'"\\]|'[^']*'|"[^"]*")+/g) ?? [];
  const found: string[] = [];
  for (const part of parts) {
    const candidate = tidyAddress(part);
    if (!TYPES[path.extname(candidate).toLowerCase()]) continue;
    if (!path.isAbsolute(candidate)) continue;
    if (existsSync(candidate)) found.push(candidate);
  }
  return [...new Set(found)];
}

export type ImageLoad = { ok: true; image: ImageAttachment } | { ok: false; reason: string };

export async function loadImageFile(file: string): Promise<ImageLoad> {
  const mediaType = TYPES[path.extname(file).toLowerCase()];
  if (!mediaType) return { ok: false, reason: `${path.basename(file)} isn't a picture I can look at (png, jpg, gif or webp).` };
  try {
    const info = await stat(file);
    if (info.size > MAX_IMAGE_BYTES) {
      return { ok: false, reason: `${path.basename(file)} is ${(info.size / 1024 / 1024).toFixed(1)} MB - over the 5 MB a picture can be. Shrink it or take a smaller screenshot.` };
    }
    return { ok: true, image: { name: path.basename(file), mediaType, data: (await readFile(file)).toString('base64') } };
  } catch {
    return { ok: false, reason: `${path.basename(file)} couldn't be opened.` };
  }
}

export function tooBig(image: ImageAttachment): boolean {
  return Buffer.byteLength(image.data, 'base64') > MAX_IMAGE_BYTES;
}

// The computer's own "choose a picture" window, so nobody has to know a file's address:
// the Finder-style window on a Mac (osascript), the Open dialog on Windows (PowerShell), zenity
// or kdialog on Linux. Returns the chosen file's address, or null when cancelled.
export async function pickPictureFile(): Promise<string | null> {
  // The practice runs can name the answer instead of opening a real window.
  if (process.env.NODE_ENV === 'test' && process.env.JEEVES_PICKER_FILE) return process.env.JEEVES_PICKER_FILE;
  const clean = (buffer: Buffer) => buffer.toString().trim() || null;
  if (platform() === 'darwin') {
    const out = await run('osascript', ['-e', 'POSIX path of (choose file with prompt "Choose a picture to show Jeeves" of type {"public.image"})']).catch(() => Buffer.alloc(0));
    return clean(out);
  }
  if (platform() === 'win32') {
    const script =
      "Add-Type -AssemblyName System.Windows.Forms; $d = New-Object System.Windows.Forms.OpenFileDialog; $d.Title = 'Choose a picture to show Jeeves'; $d.Filter = 'Pictures|*.png;*.jpg;*.jpeg;*.gif;*.webp'; if ($d.ShowDialog() -eq 'OK') { $d.FileName }";
    return clean(await run('powershell.exe', ['-NonInteractive', '-NoProfile', '-Sta', '-command', script]).catch(() => Buffer.alloc(0)));
  }
  const zenity = await run('zenity', ['--file-selection', '--title=Choose a picture to show Jeeves', '--file-filter=Pictures | *.png *.jpg *.jpeg *.gif *.webp']).catch(() => Buffer.alloc(0));
  if (zenity.length) return clean(zenity);
  return clean(await run('kdialog', ['--getopenfilename', '.', 'Pictures (*.png *.jpg *.jpeg *.gif *.webp)']).catch(() => Buffer.alloc(0)));
}
