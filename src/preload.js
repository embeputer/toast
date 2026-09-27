const { contextBridge, ipcRenderer } = require('electron');

const SEND_CHANNELS = new Set([
  'toast:navigate',
  'toast:new-tab',
  'toast:close-tab',
  'toast:activate-tab',
  'toast:back',
  'toast:forward',
  'toast:reload',
  'toast:stop',
  'toast:toggle-sidebar',
]);

const RECEIVE_CHANNELS = new Set(['toast:state', 'toast:event']);

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
