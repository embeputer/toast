const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = new Set(['toast:devtools']);
const RECEIVE_CHANNELS = new Set(['toast:event']);

contextBridge.exposeInMainWorld('toast', {
  send(channel, ...args) {
    if (SEND_CHANNELS.has(channel)) ipcRenderer.send(channel, ...args);
  },
  on(channel, cb) {
    if (!RECEIVE_CHANNELS.has(channel)) return () => {};
    const listener = (e, ...args) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
