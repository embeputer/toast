const { contextBridge, ipcRenderer } = require('electron');

const sendChannels = new Set([
  'toast:devtools',
  'toast:pill-state',
  'toast:pill-intent',
  'toast:pill-size',
  'toast:pill-request',
  'toast:pill-focus',
]);
const onChannels = new Set([
  'toast:event',
  'toast:pill-intent',
  'pill:state',
  'pill:focus',
  'pill:init',
]);

contextBridge.exposeInMainWorld('toast', {
  send(channel, ...args) {
    if (sendChannels.has(channel)) ipcRenderer.send(channel, ...args);
  },
  on(channel, cb) {
    if (!onChannels.has(channel)) return () => {};
    const listener = (e, ...args) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
