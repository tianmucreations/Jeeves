// Draws the Jeeves icon (icon.html) to a 1024px PNG. Run: electron scripts/make-icon.mjs
import { app, BrowserWindow } from 'electron';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, useContentSize: true, webPreferences: { offscreen: true } });
  await win.loadFile(path.join(here, 'icon.html'));
  await new Promise((r) => setTimeout(r, 800));
  const image = await win.webContents.capturePage({ x: 0, y: 0, width: 1024, height: 1024 });
  writeFileSync(path.join(here, '..', 'build', 'icon-1024.png'), image.resize({ width: 1024, height: 1024 }).toPNG());
  app.exit(0);
});
