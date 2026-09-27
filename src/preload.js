const { contextBridge, ipcRenderer } = require('electron');

const sendChannels = new Set([
  'toast:devtools',
  'toast:pill-state',
  'toast:pill-intent',
  'toast:pill-size',
  'toast:pill-request',
  'toast:pill-focus',
  'toast:switcher',
  'toast:focus-host',
  'toast:settings-set',
]);
const onChannels = new Set([
  'toast:event',
  'toast:pill-intent',
  'pill:state',
  'pill:focus',
  'pill:init',
  'toast:switcher-key',
  'toast:switcher-commit',
  'toast:download',
  'toast:notify',
]);

contextBridge.exposeInMainWorld('toast', {
  send(channel, ...args) {
    if (sendChannels.has(channel)) ipcRenderer.send(channel, ...args);
  },
  invoke(channel, ...args) {
    if (channel === 'toast:settings-get') return ipcRenderer.invoke(channel, ...args);
    return Promise.reject(new Error('blocked'));
  },
  on(channel, cb) {
    if (!onChannels.has(channel)) return () => {};
    const listener = (e, ...args) => cb(...args);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },
});
