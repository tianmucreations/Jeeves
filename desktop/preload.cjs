// The only doors between the window and the engine (the window itself has no Node).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jeeves', {
  ready: () => ipcRenderer.invoke('ready'),
  chooseFolder: (folder) => ipcRenderer.invoke('choose-folder', folder ?? null),
  send: (text) => ipcRenderer.send('send', text),
  answer: (letter) => ipcRenderer.send('answer', letter),
  stop: () => ipcRenderer.send('stop'),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  setAddress: (value) => ipcRenderer.invoke('set-address', value),
  settings: () => ipcRenderer.invoke('settings'),
  models: (provider) => ipcRenderer.invoke('models', provider),
  chooseModel: (provider, id) => ipcRenderer.invoke('choose-model', provider, id),
  saveKey: (provider, key) => ipcRenderer.invoke('save-key', provider, key),
  removeKey: (provider) => ipcRenderer.invoke('remove-key', provider),
  signIn: () => ipcRenderer.invoke('openrouter-sign-in'),
  cancelSignIn: () => ipcRenderer.send('openrouter-sign-in-cancel'),
  setLimit: (value) => ipcRenderer.invoke('set-limit', value),
  onOpenSettings: (listener) => ipcRenderer.on('open-settings', () => listener()),
  onSettingsChanged: (listener) => ipcRenderer.on('settings-changed', () => listener()),
  onState: (listener) => ipcRenderer.on('state', (_event, state) => listener(state)),
});
