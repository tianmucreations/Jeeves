// Jeeves Desktop - prototype (19 Sept 2026).
// The window is Electron (as OpenCode and Goose); the engine is the same compiled
// Jeeves the terminal runs (../dist), loaded into Electron's own Node. The engine
// reports everything through its session store, so this file only mirrors that store
// to the window and passes the person's messages and answers back.
// Prototype limits: the engine runs in the main process (a utilityProcess comes
// later); choosing a model and adding keys still happen in the terminal Jeeves.
import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { loadShellEnv } from './shell-env.js';

// Before anything else: the terminal's settings, so commands find their programs.
loadShellEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = (file) => import(new URL(`../dist/${file}`, import.meta.url).href);

const { session } = await engine('state/session.js');
const { runTurn } = await engine('agent/loop.js');
const { answerApproval, currentApprovalTrustable } = await engine('agent/permissions.js');
const providers = await engine('providers/index.js');
const config = await engine('platform/config.js');
const { loadModels } = await engine('models/registry.js');
const { toolLineText } = await engine('components/transcript-layout.js');
const { footerSegments, shortModelName } = await engine('components/Footer.js');
const { allowanceToday } = await engine('agent/spending.js');
const { isAuto, workerModel } = await engine('agent/auto.js');
const { killAllRunningCommands } = await engine('tools/runBash.js');

let win = null;
let folder = null;
// False until the keychain has been read, so the window never says "no key" too early.
let keysChecked = false;

// The same start-up the terminal Jeeves does (app.tsx), minus the screens.
function startEngine() {
  session.setFavorites(config.getFavorites());
  session.setDailyLimit(config.getDailyLimit());
  session.setRecents(config.getRecents());
  session.setRecentProjects(config.getRecentProjects());
  if (config.getVerbosePreference()) session.setVerbose(true);
  const model = config.getDefaultModel();
  if (model) session.setModel(model);
  const provider = config.getDefaultProvider();
  if (provider) session.setProvider(provider);
  void loadModels().then(({ models, error }) => session.setModels(models, error));
  void providers.initKeys().then(() => {
    keysChecked = true;
    if (providers.hasCredentials()) void providers.refreshCredit();
    else session.setStatus('disconnected');
    sendState();
  });
}

function niceFolder(p) {
  const home = os.homedir();
  return p && p.startsWith(home) ? '~' + p.slice(home.length) : p;
}

// Everything the window draws, in one plain object.
function snapshot() {
  const s = session;
  const transcript = s.transcript.map((entry) => {
    if (entry.kind !== 'tool') return { id: entry.id, kind: entry.kind, text: entry.text };
    const line = toolLineText(entry.data);
    // The window shows its own buttons for a question, so the "(y/n)" text goes.
    const text = entry.data.state === 'awaiting' ? line.text.replace(/ — allow\? \(y\/n\)$/, '') : line.text;
    return { id: entry.id, kind: 'tool', state: entry.data.state, text, color: line.color ?? null, dim: !!line.dim };
  });
  const segments = footerSegments({
    providerId: s.providerId,
    allowance: allowanceToday(),
    tidying: s.tidying,
    busyNote: s.busyNote ?? (s.thinkingSince !== null ? 'thinking…' : null),
    todaySpend: s.todaySpend,
    creditRemaining: s.creditRemaining,
    creditIsAccount: s.creditIsAccount,
    planResetAt: s.planResetAt,
  });
  return {
    folder: folder ? niceFolder(folder) : null,
    folderName: folder ? path.basename(folder) : null,
    // Only folders that still exist, and never the test folders of a checking session.
    recentProjects: s.recentProjects.filter((p) => existsSync(p) && !p.startsWith('/private/tmp/')).map((p) => ({ path: p, name: path.basename(p), nice: niceFolder(p) })),
    address: config.getAddress() ?? 'Sir',
    keysChecked,
    hasKeys: providers.hasCredentials(),
    status: s.status,
    approval: s.approvalPending ? { trustable: currentApprovalTrustable() } : null,
    queued: s.queued.length,
    thinkingSince: s.thinkingSince,
    workingSince: s.status === 'idle' || s.status === 'disconnected' ? null : workingSince,
    transcript,
    model: isAuto(s.model) ? `auto · ${shortModelName(s.activeModel ?? workerModel())}` : shortModelName(s.model),
    segments,
  };
}

// The store changes on every word that streams in; the window is sent at most
// one picture every 40 ms, and always the latest.
let pending = null;
// When the current job started, for the "Working… 5s" note.
let workingSince = null;
function sendState() {
  if (session.status === 'working' && workingSince === null) workingSince = Date.now();
  if (session.status === 'idle' || session.status === 'disconnected') workingSince = null;
  if (pending || !win) return;
  pending = setTimeout(() => {
    pending = null;
    if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
  }, 40);
}
session.subscribe(sendState);

function openFolder(target) {
  try {
    process.chdir(target);
  } catch {
    return false;
  }
  folder = target;
  const updated = [target, ...session.recentProjects.filter((p) => p !== target)].slice(0, 10);
  session.setRecentProjects(updated);
  // Test pictures never touch the person's saved folder list.
  if (!process.env.JEEVES_DESKTOP_SHOT) config.setRecentProjects(updated);
  session.launchComplete();
  session.addNotice(`Now working in ${niceFolder(target)}.`);
  return true;
}

// Sends a message, then any sent while Jeeves was busy (as Input.tsx does).
async function sendAndDrain(text) {
  await runTurn(text);
  for (let next = session.takeQueued(); next !== undefined; next = session.takeQueued()) await runTurn(next);
}

// The terminal's full-screen menus aren't in the window yet.
const TERMINAL_ONLY = new Set(['/model', '/keys', '/help', '/address']);

ipcMain.handle('ready', () => snapshot());
ipcMain.handle('choose-folder', async (_event, chosen) => {
  let target = chosen;
  if (!target) {
    const result = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'], buttonLabel: 'Work here' });
    if (result.canceled || !result.filePaths[0]) return false;
    target = result.filePaths[0];
  }
  const ok = openFolder(target);
  sendState();
  return ok;
});
ipcMain.on('send', (_event, raw) => {
  const text = String(raw ?? '').trim();
  if (!text) return;
  if (TERMINAL_ONLY.has(text)) {
    session.addNotice(`${text} isn't in the desktop window yet - open Jeeves in Terminal for that for now.`);
    return;
  }
  if (text === '/exit') {
    app.quit();
    return;
  }
  if (session.status !== 'working') {
    void sendAndDrain(text);
  } else {
    session.queueMessage(text);
    session.addNotice(`Noted - I'll read this as soon as I've finished: "${text.length > 80 ? text.slice(0, 79) + '…' : text}"`);
  }
});
ipcMain.on('answer', (_event, answer) => {
  if (!session.approvalPending) return;
  if (answer === 'y') answerApproval(true);
  else if (answer === 'a' && currentApprovalTrustable()) answerApproval(true, true);
  else if (answer === 'n') answerApproval(false);
});
ipcMain.on('open-external', (_event, url) => {
  if (/^https:\/\//.test(String(url))) void shell.openExternal(String(url));
});

function createWindow() {
  win = new BrowserWindow({
    width: 1080,
    height: 780,
    minWidth: 560,
    minHeight: 420,
    backgroundColor: '#000000',
    titleBarStyle: 'hiddenInset',
    title: 'Jeeves',
    show: false,
    webPreferences: {
      preload: path.join(here, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  // JEEVES_DESKTOP_SHOT=<folder>: pictures of the window for checking, taken hidden.
  if (process.env.JEEVES_DESKTOP_SHOT) win.webContents.once('did-finish-load', () => void takeShots(process.env.JEEVES_DESKTOP_SHOT));
  else win.once('ready-to-show', () => win.show());
  void win.loadFile(path.join(here, 'index.html'));
  // Links never open inside Jeeves's window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
}

// A pretend conversation (no model is asked, nothing is spent) and a real question.
async function takeShots(out) {
  const { requestApproval } = await engine('agent/permissions.js');
  const { writeFileSync, mkdirSync } = await import('node:fs');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const shot = async (name) => {
    await wait(600);
    writeFileSync(path.join(out, name), (await win.webContents.capturePage()).toPNG());
  };
  const started = Date.now();
  while (!keysChecked && Date.now() - started < 20000) await wait(100);
  console.log(`keys read after ${Date.now() - started} ms (found: ${providers.hasCredentials()})`);
  await shot('1-welcome.png');
  const demo = path.join(out, 'Demo Project');
  mkdirSync(demo, { recursive: true });
  openFolder(demo);
  // JEEVES_DESKTOP_LIVE=1: one real message through the real engine.
  if (process.env.JEEVES_DESKTOP_LIVE) {
    const t = Date.now();
    const job = sendAndDrain('How Jeeves how are you going. Write me a poem about the sunrise of about 200 words');
    await wait(12_000);
    await shot('5-thinking.png');
    await job;
    console.log(`PATH has node: ${process.env.PATH.split(':').some((dir) => existsSync(path.join(dir, 'node')))}`);
    console.log(`live reply finished in ${Date.now() - t} ms, status ${session.status}`);
    await shot('4-live.png');
    app.exit(0);
    return;
  }
  session.addUser('Tidy my Downloads folder into folders by file type, and tell me what you moved.');
  const done = session.addToolLine('listDir', 'Downloads', 'running');
  session.updateToolLine(done, { state: 'done', label: 'Listed Downloads (42 items)' });
  const reply = session.startAssistant();
  session.setAssistantText(reply, "## What I found\nThere are **42 files**: 18 photos, 11 PDFs, 9 spreadsheets and 4 installers.\nI'll make four folders - `Photos`, `Documents`, `Spreadsheets` and `Installers` - and move each file into its folder. Nothing will be deleted.");
  session.addToolLine('runBash', 'mkdir -p Photos Documents Spreadsheets Installers', 'awaiting');
  const answered = requestApproval({ trustable: true });
  await shot('2-question.png');
  win.setSize(620, 700);
  await shot('3-narrow.png');
  app.exit(0);
  void answered;
}

app.whenReady().then(() => {
  startEngine();
  createWindow();
});
app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => killAllRunningCommands());
