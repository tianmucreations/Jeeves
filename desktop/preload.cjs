// The only doors between the window and the engine (the window itself has no Node).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('jeeves', {
  ready: () => ipcRenderer.invoke('ready'),
  chooseFolder: (folder) => ipcRenderer.invoke('choose-folder', folder ?? null),
  send: (text) => ipcRenderer.send('send', text),
  answer: (letter) => ipcRenderer.send('answer', letter),
  openExternal: (url) => ipcRenderer.send('open-external', url),
  onState: (listener) => ipcRenderer.on('state', (_event, state) => listener(state)),
});
