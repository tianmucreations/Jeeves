// Jeeves Desktop - prototype (19 Sept 2026).
// The window is Electron (as OpenCode and Goose); the engine is the same compiled
// Jeeves the terminal runs (../dist), loaded into Electron's own Node. The engine
// reports everything through its session store, so this file only mirrors that store
// to the window and passes the person's messages and answers back.
// Prototype limits: the engine runs in the main process (a utilityProcess comes
// later); choosing a model and adding keys still happen in the terminal Jeeves.
import { app, BrowserWindow, ipcMain, dialog, shell, Menu, Notification, clipboard as systemClipboard } from 'electron';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

import { loadShellEnv } from './shell-env.js';
import { registerSettings } from './settings.js';

// Before anything else: the terminal's settings, so commands find their programs.
loadShellEnv();

const here = path.dirname(fileURLToPath(import.meta.url));
const engine = (file) => import(new URL(`../dist/${file}`, import.meta.url).href);

// Batch 6 (25 Sept): the engine must never take the window down with it. An
// unexpected error inside the engine is caught here, shown in the window as a
// plain banner (the renderer offers "Carry on"), and the app stays alive. The
// full split - the engine in its own helper process, as OpenCode's desktop does
// - is its own project on the plan; this is the guarantee, delivered without
// rewriting every screen at once.
let lastCrashNotice = 0;
function reportEngineCrash(detail) {
  const now = Date.now();
  console.error(`[engine] ${detail}`);
  if (now - lastCrashNotice < 30_000) return;
  lastCrashNotice = now;
  if (win && !win.isDestroyed()) win.webContents.send('engine-crashed', { message: String(detail).slice(0, 160) });
}
process.on('uncaughtException', (error) => reportEngineCrash(error instanceof Error ? error.message : String(error)));
process.on('unhandledRejection', (reason) => reportEngineCrash(reason instanceof Error ? reason.message : String(reason)));

const { session } = await engine('state/session.js');
const { runTurn, stopTurn } = await engine('agent/loop.js');
const { answerApproval, currentApprovalTrustable } = await engine('agent/permissions.js');
const providers = await engine('providers/index.js');
const config = await engine('platform/config.js');
const { loadModels } = await engine('models/registry.js');
const { toolLineText, isQuietEntry } = await engine('components/transcript-layout.js');
const { footerSegments, shortModelName } = await engine('components/Footer.js');
const { allowanceToday } = await engine('agent/spending.js');
const { isAuto, workerModel } = await engine('agent/auto.js');
const { killAllRunningCommands } = await engine('tools/runBash.js');
const { ensureChatFolder, chatNotice } = await engine('platform/chat-folder.js');
const { cleanAddress } = await engine('platform/address.js');

let win = null;
let folder = null;
// The folder being left while another is chosen (null when not changing).
let previousFolder = null;
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
  const transcript = s.transcript.filter((entry) => !isQuietEntry(entry, s.verbose)).map((entry) => {
    if (entry.kind !== 'tool') return { id: entry.id, kind: entry.kind, text: entry.text };
    const line = toolLineText(entry.data);
    // The window shows its own buttons for a question, so the "(y/n)" text goes.
    const text = entry.data.state === 'awaiting' ? line.text.replace(/ — allow\? \(y\/n\)$/, '') : line.text;
    return { id: entry.id, kind: 'tool', state: entry.data.state, text, color: line.color ?? null, dim: !!line.dim, detail: entry.data.detail ?? null };
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
    zaiQuota: s.zaiQuota,
    connected: providers.hasCredentials(),
    connectHint: 'open Settings to connect',
  });
  return {
    // A visible warning, not a silent one: a test session used to be invisible
    // from the window itself, which is exactly what let a real one be mistaken
    // for it (the model-forgetting report, 22 Sept - see PROGRESS.md).
    testMode: process.env.NODE_ENV === 'test',
    folder: folder ? niceFolder(folder) : null,
    folderName: folder ? path.basename(folder) : null,
    // Choosing another folder mid-conversation (the welcome screen offers a way back).
    changingFolder: !folder && previousFolder !== null,
    // Only folders that still exist, and never the test folders of a checking session.
    recentProjects: s.recentProjects.filter((p) => existsSync(p) && !p.startsWith('/private/tmp/')).map((p) => ({ path: p, name: path.basename(p), nice: niceFolder(p) })),
    // null until the person has said how to be addressed - the window asks first.
    address: config.getAddress(),
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
  watchApprovalForNotify();
  if (session.status === 'working' && workingSince === null) workingSince = Date.now();
  if (session.status === 'idle' || session.status === 'disconnected') workingSince = null;
  if (pending || !win) return;
  pending = setTimeout(() => {
    pending = null;
    if (win && !win.isDestroyed()) win.webContents.send('state', snapshot());
  }, 40);
}
session.subscribe(sendState);

// Claude Code's useNotifyAfterTimeout: a permission question is a stopped job.
// If it still waits six seconds later and the person is elsewhere, the Mac says
// so; clicking the notification brings the window forward. Each question gets
// its own timer (the serial number tells them apart).
let approvalNotifyTimer = null;
let lastApprovalSerial = 0;
function watchApprovalForNotify() {
  if (session.approvalSerial === lastApprovalSerial) return;
  lastApprovalSerial = session.approvalSerial;
  if (approvalNotifyTimer) clearTimeout(approvalNotifyTimer);
  approvalNotifyTimer = setTimeout(() => {
    approvalNotifyTimer = null;
    if (!session.approvalPending || !win || win.isDestroyed() || win.isFocused()) return;
    const note = new Notification({ title: 'Jeeves', body: 'Jeeves needs your permission to continue.' });
    note.on('click', () => {
      if (win && !win.isDestroyed()) {
        win.show();
        win.focus();
      }
    });
    note.show();
  }, 6_000);
}
await registerSettings(
  engine,
  () => {
    sendState();
    if (win && !win.isDestroyed()) win.webContents.send('settings-changed');
  },
  (channel, data) => {
    if (win && !win.isDestroyed()) win.webContents.send(channel, data);
  },
);

// remember: false for "Just chat" - its folder is not a project, so it never
// joins the recent list (as in the terminal's ProjectPicker).
function openFolder(target, remember = true) {
  try {
    process.chdir(target);
  } catch {
    return false;
  }
  // Moving mid-conversation: it carries on, and the model is told (as the terminal's /folder).
  const leaving = folder ?? previousFolder;
  if (leaving && leaving !== target) {
    session.pendingContextNote = `[The person moved Jeeves to ${remember ? `the folder ${target}` : `the chat folder ${target}`}. Files mentioned earlier may not be here - look again before relying on them.]`;
  }
  folder = target;
  previousFolder = null;
  if (remember) {
    const updated = [target, ...session.recentProjects.filter((p) => p !== target)].slice(0, 10);
    session.setRecentProjects(updated);
    // Test pictures never touch the person's saved folder list.
    if (!process.env.JEEVES_DESKTOP_SHOT) config.setRecentProjects(updated);
  }
  session.launchComplete();
  session.addNotice(remember ? `Now working in ${niceFolder(target)}.` : chatNotice(config.getAddress() ?? 'Sir'));
  return true;
}

// Sends a message, then any sent while Jeeves was busy (as Input.tsx does).
async function sendAndDrain(text) {
  await runTurn(text);
  for (let next = session.takeQueued(); next !== undefined; next = session.takeQueued()) await runTurn(next);
}

// The terminal's full-screen menus aren't in the window yet.
// /model, /keys and /address open Settings; /help opens the Help panel.
const OPENS_SETTINGS = new Set(['/model', '/keys', '/address']);

// Back to the welcome screen to pick another folder (or Just chat); the
// conversation stays. Between tasks only, as in the terminal.
function changeFolder() {
  if (session.status === 'working' || session.approvalPending) {
    session.addNotice('The folder can be changed between tasks.');
    return;
  }
  previousFolder = folder;
  folder = null;
  sendState();
}
ipcMain.on('change-folder', changeFolder);
ipcMain.on('cancel-change-folder', () => {
  if (previousFolder && !folder) folder = previousFolder;
  sendState();
});

ipcMain.handle('ready', () => snapshot());
// Highlighted text is copied here (the window's own clipboard door refuses when it is not the focused window).
ipcMain.handle('copy-text', (_event, text) => {
  if (typeof text !== 'string' || !text) return false;
  systemClipboard.writeText(text.slice(0, 1_000_000));
  return true;
});
// How to address the person (the terminal's AddressPrompt, same rules).
ipcMain.handle('set-address', (_event, raw) => {
  const address = cleanAddress(String(raw ?? ''));
  if (!address) return { ok: false, message: "Choose Sir or Ma'am, or type what you'd like to be called." };
  const first = !config.getAddress();
  config.setAddress(address);
  session.skipAddressStage();
  if (!first) session.addNotice(`Very good - I shall address you as ${address}.`);
  sendState();
  return { ok: true, message: `Very good - I shall address you as ${address}.` };
});
ipcMain.handle('choose-folder', async (_event, chosen) => {
  if (chosen === 'just-chat') {
    const chat = ensureChatFolder();
    const ok = chat ? openFolder(chat, false) : false;
    sendState();
    return ok;
  }
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
  if (text === '/folder') {
    changeFolder();
    return;
  }
  if (OPENS_SETTINGS.has(text)) {
    win?.webContents.send('open-settings');
    return;
  }
  if (text === '/help') {
    win?.webContents.send('open-help');
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
ipcMain.on('stop', () => {
  stopTurn();
});
ipcMain.on('answer', (_event, answer) => {
  if (!session.approvalPending) return;
  if (answer === 'y') answerApproval(true);
  else if (answer === 'a' && currentApprovalTrustable()) answerApproval(true, 'project');
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
    // The window buttons sit level with the larger gold name.
    trafficLightPosition: { x: 22, y: 30 },
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
  if (process.env.JEEVES_DESKTOP_SHOT) win.webContents.on('console-message', (event) => console.log(`[window] ${event.level}: ${event.message} (${event.sourceId?.split('/').pop()}:${event.lineNumber})`));
  if (process.env.JEEVES_DESKTOP_SHOT) win.webContents.once('did-finish-load', () => void takeShots(process.env.JEEVES_DESKTOP_SHOT));
  else win.once('ready-to-show', () => win.show());
  void win.loadFile(path.join(here, 'index.html'));
  // If the window's own rendering dies, bring it back: the engine (and the
  // conversation it holds) lives on in the app.
  win.webContents.on('render-process-gone', () => {
    if (win && !win.isDestroyed()) win.webContents.reload();
  });
  // Links never open inside Jeeves's window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (event) => event.preventDefault());
  // Right-click: Copy on selected text, and Cut / Paste where typing is possible
  // (OpenCode Desktop does the same with electron-context-menu).
  win.webContents.on('context-menu', (_event, params) => {
    const items = [];
    if (params.isEditable) items.push({ role: 'cut', enabled: params.editFlags.canCut });
    if (params.selectionText) items.push({ role: 'copy' });
    if (params.isEditable) items.push({ role: 'paste', enabled: params.editFlags.canPaste });
    items.push({ role: 'selectAll' });
    Menu.buildFromTemplate(items).popup({ window: win });
  });
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
  // JEEVES_DESKTOP_ADDRESSTEST=1 (with NODE_ENV=test only): a new person's first question.
  if (process.env.JEEVES_DESKTOP_ADDRESSTEST && process.env.NODE_ENV === 'test') {
    config.clearAddress();
    sendState();
    await wait(600);
    await shot('15-ask-address.png');
    await win.webContents.executeJavaScript("document.querySelector('[data-address=\\'Ma\\\\\\'am\\']')?.click() ?? [...document.querySelectorAll('[data-address]')][1].click()");
    await wait(800);
    console.log(`saved address: ${config.getAddress()} | greeting: ${await win.webContents.executeJavaScript("document.getElementById('greeting').textContent")}`);
    await shot('16-after-address.png');
    config.clearAddress();
    app.exit(0);
    return;
  }
  // JEEVES_DESKTOP_CONNECTTEST=1 (with an empty test keychain): a new person with no AI service.
  if (process.env.JEEVES_DESKTOP_CONNECTTEST && process.env.NODE_ENV === 'test') {
    config.setAddress("Ma'am");
    sendState();
    await wait(800);
    await shot('17-connect.png');
    const js = (code) => win.webContents.executeJavaScript(code);
    await js("document.getElementById('welcome-key').value = 'not-a-key'; document.getElementById('welcome-key-form').requestSubmit()");
    await wait(500);
    console.log(`bad key answer: ${await js("document.getElementById('welcome-connect-note').textContent")}`);
    await js("document.getElementById('welcome-connect-note').dataset.waiting = '1'");
    win.webContents.send('sign-in-url', 'https://openrouter.ai/auth?example');
    await wait(300);
    console.log(`while waiting: ${await js("document.getElementById('welcome-connect-note').textContent")}`);
    await shot('18-connect-waiting.png');
    config.clearAddress();
    app.exit(0);
    return;
  }
  // JEEVES_DESKTOP_FOLDERTEST=1: from Just chat, change to a folder and back.
  if (process.env.JEEVES_DESKTOP_FOLDERTEST && process.env.NODE_ENV === 'test') {
    const js = (code) => win.webContents.executeJavaScript(code);
    config.setAddress("Ma'am");
    sendState();
    await wait(600);
    await js("document.getElementById('just-chat').click()");
    await wait(800);
    await js("document.getElementById('folder').click()");
    await wait(800);
    console.log(`after clicking the folder label: welcome shown ${await js("!document.getElementById('welcome').hidden")}, back button shown ${await js("!document.getElementById('back-to-chat').hidden")}`);
    await shot('19-change-folder.png');
    await js("document.getElementById('back-to-chat').click()");
    await wait(800);
    console.log(`after Back: in chat ${await js("!document.getElementById('chat').hidden")}, folder ${await js("document.getElementById('folder').textContent")}`);
    await js("document.getElementById('folder').click()");
    await wait(600);
    const demo = path.join(out, 'Demo Project');
    mkdirSync(demo, { recursive: true });
    await win.webContents.executeJavaScript(`window.jeeves.chooseFolder(${JSON.stringify(demo)})`);
    await wait(800);
    console.log(`after choosing a folder: folder ${await js("document.getElementById('folder').textContent")}, model told: ${Boolean(session.pendingContextNote)}, last line: ${session.transcript.at(-1)?.text}`);
    config.clearAddress();
    app.exit(0);
    return;
  }
  // JEEVES_DESKTOP_HELPTEST=1: /help and /address in the window.
  if (process.env.JEEVES_DESKTOP_HELPTEST) {
    const js = (code) => win.webContents.executeJavaScript(code);
    await js("document.getElementById('just-chat').click()");
    await wait(800);
    ipcMain.emit('send', {}, '/help');
    await wait(600);
    console.log(`/help opens the Help panel: ${await js("!document.getElementById('help').hidden")}`);
    await shot('20-help.png');
    ipcMain.emit('send', {}, '/address');
    await wait(1200);
    console.log(`/address opens Settings: ${await js("!document.getElementById('settings').hidden")}, help closed: ${await js("document.getElementById('help').hidden")}`);
    app.exit(0);
    return;
  }
  // JEEVES_DESKTOP_CHATTEST=1: press "Just chat".
  if (process.env.JEEVES_DESKTOP_CHATTEST) {
    const recentsBefore = JSON.stringify(config.getRecentProjects());
    await win.webContents.executeJavaScript("document.getElementById('just-chat').click()");
    await wait(1200);
    console.log(`working in: ${process.cwd()} | recent list unchanged: ${JSON.stringify(config.getRecentProjects()) === recentsBefore}`);
    await shot('13-just-chat.png');
    app.exit(0);
    return;
  }
  const demo = path.join(out, 'Demo Project');
  mkdirSync(demo, { recursive: true });
  openFolder(demo);
  // JEEVES_DESKTOP_SETTINGSTEST=1: open Settings and look around (changes nothing).
  if (process.env.JEEVES_DESKTOP_SETTINGSTEST) {
    win.webContents.send('open-settings');
    await wait(2_500);
    await shot('8-settings.png');
    await win.webContents.executeJavaScript("[...document.querySelectorAll('.service')].find((b) => b.textContent.startsWith('OpenRouter')).click()");
    await wait(2_500);
    await shot('9-settings-openrouter.png');
    await win.webContents.executeJavaScript("[...document.querySelectorAll('.service')].find((b) => b.textContent.startsWith('Anthropic')).click()");
    await wait(1_000);
    await shot('10-settings-key.png');
    await win.webContents.executeJavaScript("[...document.querySelectorAll('.service')].find((b) => b.textContent.startsWith('OpenRouter')).click()");
    await wait(1_500);
    await win.webContents.executeJavaScript("[...document.querySelectorAll('.tab')].find((b) => b.textContent.startsWith('Free')).click(); document.querySelector('.settings-body').scrollTop = 99999");
    await wait(500);
    console.log(`free tab: ${await win.webContents.executeJavaScript("[...document.querySelectorAll('.tab')].map((b) => b.textContent).join(' | ') + ' -> ' + document.querySelectorAll('#service-detail .model-row').length + ' rows'")}`);
    await shot('14-free.png');
    // Only against the test settings (NODE_ENV=test): really choose a model.
    if (process.env.NODE_ENV === 'test') {
      await win.webContents.executeJavaScript("[...document.querySelectorAll('.service')].find((b) => b.textContent.startsWith('Z.ai')).click()");
      await wait(1_000);
      await win.webContents.executeJavaScript("[...document.querySelectorAll('.model-row')].find((b) => b.textContent.startsWith('GLM-5.3-Flash')).click()");
      await wait(1_000);
      console.log(`after choosing: provider ${session.providerId}, model ${session.model}, saved default ${config.getDefaultModel()}`);
      await shot('11-chosen.png');
    }
    app.exit(0);
    return;
  }
  // JEEVES_DESKTOP_FOCUSTEST=1: the typing box gets the cursor back (changes nothing).
  if (process.env.JEEVES_DESKTOP_FOCUSTEST) {
    const js = (code) => win.webContents.executeJavaScript(code);
    await wait(800);
    win.focusOnWebView();
    await js("document.getElementById('open-settings').focus(); document.activeElement.id");
    console.log(`before typing, the cursor is in: ${await js('document.activeElement.id || document.activeElement.tagName')}`);
    for (const ch of 'hi') {
      win.webContents.sendInputEvent({ type: 'keyDown', keyCode: ch });
      win.webContents.sendInputEvent({ type: 'char', keyCode: ch });
      win.webContents.sendInputEvent({ type: 'keyUp', keyCode: ch });
      await wait(100);
    }
    console.log(`after typing "hi": cursor in ${await js('document.activeElement.id')}, box holds ${JSON.stringify(await js("document.getElementById('input').value"))}`);
    app.exit(0);
    return;
  }
  // JEEVES_DESKTOP_STOPTEST=1: start a real job, press Stop while it thinks.
  if (process.env.JEEVES_DESKTOP_STOPTEST) {
    const t = Date.now();
    const job = sendAndDrain('Write me a poem about the sunrise of about 200 words');
    await wait(6_000);
    await shot('6-working.png');
    win.webContents.executeJavaScript("document.getElementById('stop').click()");
    await job;
    console.log(`stopped after ${Date.now() - t} ms, status ${session.status}, last line: ${session.transcript[session.transcript.length - 1]?.text}`);
    await shot('7-stopped.png');
    app.exit(0);
    return;
  }
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
  // JEEVES_DESKTOP_PREVIEWTEST=1: the real write gate in the window - an existing
  // file is read, then a write waits with its changed lines above the buttons;
  // after answering, the preview is gone and only the record line remains.
  if (process.env.JEEVES_DESKTOP_PREVIEWTEST) {
    const js = (code) => win.webContents.executeJavaScript(code);
    const fs = await import('node:fs/promises');
    const os = await import('node:os');
    const target = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'jeeves-preview-')), 'notes.txt');
    await fs.writeFile(target, 'old line\nkeep me');
    const { runReadFile } = await engine('tools/readFile.js');
    await runReadFile({ path: target });
    const { TOOLS } = await engine('tools/index.js');
    const call = TOOLS.writeFile.execute({ path: target, content: 'new line\nkeep me' }, { toolCallId: 'p1', messages: [] });
    await wait(800);
    await shot('21-preview.png');
    console.log(`box: ${JSON.stringify(await js("document.getElementById('approval-text').textContent"))}`);
    console.log(`detail visible: ${await js("!document.getElementById('approval-detail').hidden")}, detail: ${JSON.stringify(await js("document.getElementById('approval-detail').textContent"))}`);
    const { answerApproval } = await engine('agent/permissions.js');
    answerApproval(false);
    await call.catch(() => {});
    await wait(400);
    const last = session.transcript[session.transcript.length - 1];
    console.log(`after answering, question box hidden: ${await js("document.getElementById('approval').hidden")}, record: ${JSON.stringify(last.data && last.data.state === 'declined' ? 'you said no' : last.data?.label ?? last.text)}`);
    app.exit(0);
    return;
  }
  // JEEVES_DESKTOP_CRASHTEST=1: the engine throws unexpectedly - the window must
  // survive, show its plain banner, and stay usable.
  if (process.env.JEEVES_DESKTOP_CRASHTEST) {
    const js = (code) => win.webContents.executeJavaScript(code);
    await wait(2_000);
    setTimeout(() => {
      throw new Error('test crash - an unexpected engine error');
    }, 300);
    await wait(1_500);
    console.log(`window alive: ${!win.isDestroyed()}, banner shown: ${await js("!document.getElementById('crash-banner').hidden")}, text: ${JSON.stringify(await js("document.getElementById('crash-text').textContent.slice(0, 80)"))}`);
    await shot('22-crash.png');
    await js("document.getElementById('crash-dismiss').click()");
    await wait(400);
    console.log(`after Carry on, banner hidden: ${await js("document.getElementById('crash-banner').hidden")}, window still usable: ${!win.isDestroyed()}`);
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
  // 25 Sept: the question must appear ONCE - in the box above the typing area,
  // never also as a line in the conversation.
  console.log(`question in the flow: ${await win.webContents.executeJavaScript(`(document.getElementById('transcript').textContent.match(/allow\\?/g) || []).length`)} time(s), box: ${JSON.stringify(await win.webContents.executeJavaScript("document.getElementById('approval-text').textContent"))}`);
  // Copying: select the answer text in the window and copy it, as Command+C does.
  {
    const { clipboard } = await import('electron');
    const before = clipboard.readText();
    await win.webContents.executeJavaScript("(() => { const el = [...document.querySelectorAll('.entry.assistant')].pop(); const r = document.createRange(); r.selectNodeContents(el); const s = getSelection(); s.removeAllRanges(); s.addRange(r); })()");
    win.webContents.copy();
    await wait(300);
    console.log(`copied from the window: ${JSON.stringify(clipboard.readText().slice(0, 60))}`);
    // Highlighting alone copies it and floats "Copied to clipboard" in the corner.
    clipboard.writeText('untouched');
    await win.webContents.executeJavaScript("document.getElementById('scroller').dispatchEvent(new MouseEvent('mouseup', { bubbles: true }))");
    await wait(400);
    console.log(`toast: ${JSON.stringify(await win.webContents.executeJavaScript("(() => { const t = document.getElementById('toast'); return t.hidden ? null : t.textContent; })()"))}, clipboard now: ${JSON.stringify(clipboard.readText().slice(0, 30))}`);
    await shot('4-toast.png');
    clipboard.writeText(before);
  }
  // A real picture, window buttons included (hidden pictures leave them out).
  if (process.env.JEEVES_DESKTOP_REALSHOT) {
    const { execFileSync } = await import('node:child_process');
    win.showInactive();
    await wait(1500);
    const id = win.getMediaSourceId().split(':')[1];
    execFileSync('screencapture', ['-x', '-o', `-l${id}`, path.join(out, '12-real-window.png')]);
    // A window shown and hidden again stops painting for later hidden pictures, so stop here.
    app.exit(0);
    return;
  }
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
