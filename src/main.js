const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  protocol,
  session,
  webContents,
  clipboard,
  dialog,
} = require('electron');
const path = require('path');
const fs = require('fs');

const START_URL = 'toast://newtab/';

let liquidGlass = null;
try {
  liquidGlass = require('electron-liquid-glass');
} catch (_) {
  /* native module unavailable — CSS glass fallback handles it */
}
function glassSupported() {
  try {
    return !!(liquidGlass && liquidGlass.isGlassSupported());
  } catch (_) {
    return false;
  }
}

// in-memory download log for toast://downloads
const downloads = [];

function internalPage(kind, body) {
  return `<!doctype html><meta charset="utf-8"><title>toast://${kind}</title><style>
    body{font:14px -apple-system,'SF Pro Text',sans-serif;margin:0;padding:64px 0 40px;display:flex;flex-direction:column;align-items:center;color:rgba(0,0,0,.85);background:#f4f3f0}
    h1{font-weight:600;font-size:22px;margin:0 0 18px}
    table{border-collapse:collapse;width:min(640px,80vw);background:rgba(255,255,255,.8);border-radius:14px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
    td,th{padding:9px 14px;font-size:12.5px;text-align:left;border-bottom:.5px solid rgba(0,0,0,.06)}
    td:first-child{color:rgba(0,0,0,.5);width:110px}
    tr:last-child td{border-bottom:none}
    .empty{color:rgba(0,0,0,.4);font-size:13px;padding:18px}
    @media(prefers-color-scheme:dark){body{background:#191817;color:rgba(255,255,255,.87)}table{background:rgba(45,44,43,.8)}td{border-color:rgba(255,255,255,.08)}td:first-child{color:rgba(255,255,255,.45)}.empty{color:rgba(255,255,255,.4)}}
  </style>${body}`;
}

// ---- settings (persisted to userData/settings.json) ----

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function readSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'));
  } catch (_) {
    return {};
  }
}

function writeSettings(patch) {
  const s = { ...readSettings(), ...patch };
  fs.writeFileSync(settingsFile(), JSON.stringify(s));
  return s;
}

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'toast',
    privileges: { standard: true, secure: true, supportFetchAPI: false },
  },
]);

// host BrowserWindow -> { lights, pill } child chrome windows
const chromeByHost = new Map();
// child BrowserWindow -> host BrowserWindow
const hostByChild = new Map();

function hostWindow(guest) {
  // a <webview> guest's embedder is the window's own webContents
  const host = guest.hostWebContents;
  return host ? BrowserWindow.fromWebContents(host) : null;
}

// Resolve a window-like thing to its host browser window (children -> parent).
function asHost(win) {
  if (!win) return null;
  return hostByChild.get(win.id) || win;
}

// While the switcher overlay is open, arrows/Tab/Enter/Escape are eaten and
// relayed to the chrome, and releasing Control commits the selection.
function attachKeyIntercept(wc, host) {
  wc.on('before-input-event', (event, input) => {
    const c = chromeByHost.get(host.id);
    if (!c || !c.switcher) return;
    const down = input.type === 'keyDown' || input.type === 'rawKeyDown';
    if (down && ['ArrowLeft', 'ArrowRight', 'Tab', 'Enter', 'Escape'].includes(input.key)) {
      event.preventDefault();
      host.webContents.send('toast:switcher-key', {
        key: input.key,
        shift: !!(input.modifiers && input.modifiers.includes('shift')),
      });
    } else if (input.type === 'keyUp') {
      // commit on Control release; also on the first keyup after Control is
      // already gone — modifier releases aren't reliably delivered to every
      // webContents, so this covers releases we never saw
      if (input.key === 'Control' || !(input.modifiers || []).includes('control')) {
        host.webContents.send('toast:switcher-commit');
      }
    }
  });
}

function buildContextMenu(win, wc, params) {
  const send = (name, arg) => win.webContents.send('toast:event', name, arg);
  const items = [
    {
      label: 'Back',
      enabled: wc.navigationHistory.canGoBack(),
      click: () => wc.navigationHistory.goBack(),
    },
    {
      label: 'Forward',
      enabled: wc.navigationHistory.canGoForward(),
      click: () => wc.navigationHistory.goForward(),
    },
    { label: 'Reload', click: () => wc.reload() },
    { type: 'separator' },
  ];
  if (params.linkURL) {
    items.push({
      label: 'Open Link in New Tab',
      click: () => send('open-in-new-tab', params.linkURL),
    });
    items.push({
      label: 'Copy Link',
      click: () => clipboard.writeText(params.linkURL),
    });
  }
  if (params.isEditable) {
    items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
  } else if (params.selectionText) {
    items.push({ role: 'copy' });
  }
  items.push({ type: 'separator' }, { role: 'selectAll' }, { type: 'separator' });
  items.push({
    label: 'Inspect Element',
    click: () => wc.inspectElement(params.x, params.y),
  });
  Menu.buildFromTemplate(items).popup({ window: win });
}

// ---- floating glass chrome (real NSGlassEffectView on macOS 26+) ----
//
// The address pill is a small transparent child window filled edge-to-edge
// with a native glass view. Child windows follow the parent when it moves;
// we re-derive its position on resize/fullscreen changes. The DOM inside
// renders the pill content (favicon/title/input) on top of the glass.

const PILL_TOP = 12;

function childOpts(win, w, h) {
  return {
    parent: win,
    width: w,
    height: h,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    closable: false,
    show: false,
    skipTaskbar: true,
    alwaysOnTop: false,
    acceptFirstMouse: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  };
}

function positionPill(host, w, h) {
  const { pill } = chromeByHost.get(host.id) || {};
  if (!pill || pill.isDestroyed()) return;
  const b = host.getBounds();
  if (!w || !h) ({ width: w, height: h } = pill.getBounds());
  const top = host.isFullScreen() ? 8 : PILL_TOP;
  pill.setBounds({
    x: Math.round(b.x + (b.width - w) / 2),
    y: b.y + top,
    width: Math.round(w),
    height: Math.round(h),
  });
}

function applyGlass(win, radius) {
  if (!glassSupported()) return;
  try {
    liquidGlass.addView(win.getNativeWindowHandle(), { cornerRadius: radius });
  } catch (_) {}
}

function createChromeWindows(win) {
  const glass = glassSupported();

  const pill = new BrowserWindow(childOpts(win, 300, 30));
  pill.loadFile(path.join(__dirname, 'pill.html'));
  pill.webContents.once('did-finish-load', () => {
    positionPill(win);
    pill.showInactive();
    pill.webContents.send('pill:init', { glass });
    const cached = pillState.get(win.id);
    if (cached) pill.webContents.send('pill:state', cached);
  });

  applyGlass(pill, 15);

  chromeByHost.set(win.id, { pill, switcher: false });
  hostByChild.set(pill.id, win);
  attachKeyIntercept(pill.webContents, win);
  // like ⌘Tab: losing window focus commits the pending selection
  win.on('blur', () => {
    const c = chromeByHost.get(win.id);
    if (c && c.switcher) win.webContents.send('toast:switcher-commit');
  });

  const reposition = () => {
    positionPill(win);
  };
  win.on('resize', reposition);
  win.on('move', reposition);
  win.on('enter-full-screen', reposition);
  win.on('leave-full-screen', reposition);
  win.on('restore', reposition);
  win.on('closed', () => {
    const c = chromeByHost.get(win.id);
    if (c) {
      for (const w of [c.pill]) {
        if (!w.isDestroyed()) {
          hostByChild.delete(w.id);
          w.destroy();
        }
      }
      chromeByHost.delete(win.id);
      pillState.delete(win.id);
    }
  });
}

// latest pill state per host window (so a late-loading pill still renders)
const pillState = new Map();

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 520,
    minHeight: 320,
    title: 'Toast',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 19 },
    backgroundColor: '#f5f4f2',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  createChromeWindows(win);
  attachKeyIntercept(win.webContents, win);

  win.loadFile(path.join(__dirname, 'chrome', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.focus();
  });
  return win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (name, arg) => (menuItem, win) => {
    const target = asHost(win || BrowserWindow.getFocusedWindow());
    if (target) {
      if (name !== 'focus-url') target.webContents.focus();
      target.webContents.send('toast:event', name, arg);
    }
  };

  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: 'about' },
              { type: 'separator' },
              { role: 'hide' },
              { role: 'hideOthers' },
              { role: 'unhide' },
              { type: 'separator' },
              { role: 'quit' },
            ],
          },
        ]
      : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: send('new-tab') },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        { label: 'Close Tab', accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
        { type: 'separator' },
        {
          label: 'Load Extension…',
          click: async () => {
            const r = await dialog.showOpenDialog({
              properties: ['openDirectory'],
              message: 'Choose an unpacked extension folder',
            });
            if (r.canceled || !r.filePaths[0]) return;
            const host = BrowserWindow.getFocusedWindow();
            const target = host ? asHost(host) : null;
            const notify = (text) => {
              if (target) target.webContents.send('toast:notify', text);
            };
            try {
              const ext = await session
                .fromPartition('persist:webview')
                .loadExtension(r.filePaths[0]);
              notify(`Loaded extension ${ext.name}`);
            } catch (err) {
              notify(`Extension failed: ${err.message}`);
            }
          },
        },
        { type: 'separator' },
        ...(isMac ? [{ role: 'close' }] : [{ role: 'quit' }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'pasteAndMatchStyle' },
        { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { label: 'Command Toast', accelerator: 'CmdOrCtrl+K', click: send('focus-url') },
        { label: 'Setup…', accelerator: 'CmdOrCtrl+,', click: send('open-setup') },
        { type: 'separator' },
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: send('reload') },
        { label: 'Force Reload', accelerator: 'CmdOrCtrl+Shift+R', click: send('force-reload') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { label: 'Toggle Developer Tools', accelerator: 'Alt+CmdOrCtrl+I', click: send('devtools') },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        { label: 'Back', accelerator: 'CmdOrCtrl+[', click: send('back') },
        { label: 'Forward', accelerator: 'CmdOrCtrl+]', click: send('forward') },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        { label: 'Tab Switcher', accelerator: 'Ctrl+Tab', click: send('open-switcher') },
        { label: 'Tab Switcher', accelerator: 'Ctrl+Shift+Tab', visible: false, click: send('open-switcher') },
        { label: 'Next Tab', accelerator: 'CmdOrCtrl+Shift+]', visible: false, click: send('next-tab') },
        { label: 'Previous Tab', accelerator: 'CmdOrCtrl+Shift+[', visible: false, click: send('prev-tab') },
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => ({
          label: `Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          click: send('tab', i),
        })),
      ],
    },
    { label: 'Window', role: 'windowMenu' },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function setupGuestDefaults(wc) {
  if (wc.getType() !== 'webview') return;
  const win = hostWindow(wc);
  if (!win) return;

  wc.on('context-menu', (e, params) => buildContextMenu(win, wc, params));
  attachKeyIntercept(wc, win);
  wc.setWindowOpenHandler(({ url }) => {
    win.webContents.send('toast:event', 'open-in-new-tab', url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  app.setName('Toast');

  protocol.handle('toast', (request) => {
    const u = new URL(request.url);
    const host = u.hostname;
    if (host === 'downloads') {
      const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
      const rows = downloads.length
        ? downloads
            .map(
              (d) =>
                `<tr><td>${esc(d.state)}</td><td>${esc(d.name)}</td><td>${esc(
                  d.when
                )}</td></tr>`
            )
            .join('')
        : '<tr><td colspan="3" class="empty">No downloads yet</td></tr>';
      const body = `<h1>Downloads</h1><table><tr><th>state</th><th>file</th><th>when</th></tr>${rows}</table>`;
      return new Response(internalPage('downloads', body), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    if (host === 'version') {
      const rows = [
        ['Toast', app.getVersion()],
        ['Chromium', process.versions.chrome],
        ['Electron', process.versions.electron],
        ['V8', process.versions.v8],
        ['Node', process.versions.node],
        ['OS', `${process.platform} ${process.arch}`],
      ]
        .map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`)
        .join('');
      return new Response(internalPage('version', `<h1>toast</h1><table>${rows}</table>`), {
        headers: { 'content-type': 'text/html; charset=utf-8' },
      });
    }
    const pathName = u.pathname;
    const isIcon = pathName.endsWith('/icon.png') || pathName === '/icon.png';
    const file = path.join(__dirname, isIcon ? 'icon.png' : 'newtab.html');
    return new Response(fs.readFileSync(file), {
      headers: { 'content-type': isIcon ? 'image/png' : 'text/html; charset=utf-8' },
    });
  });

  const permissionHandler = (wc, permission, cb) => {
    const allowed = new Set([
      'media',
      'notifications',
      'geolocation',
      'fullscreen',
      'pointerLock',
      'clipboard-read',
      'clipboard-sanitized-write',
    ]);
    cb(allowed.has(permission));
  };
  const downloadHandler = (e, item, wc) => {
    item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
    const name = item.getFilename();
    const entry = { name, state: 'downloading', when: new Date().toLocaleTimeString() };
    downloads.unshift(entry);
    if (downloads.length > 50) downloads.pop();
    const host = wc ? hostWindow(wc) : null;
    if (host) host.webContents.send('toast:download', { name, state: 'started' });
    item.once('done', (ev, state) => {
      entry.state = state === 'completed' ? 'done' : state;
      if (host && !host.isDestroyed())
        host.webContents.send('toast:download', { name, state });
    });
  };
  for (const ses of [session.defaultSession, session.fromPartition('persist:webview')]) {
    ses.setPermissionRequestHandler(permissionHandler);
    ses.on('will-download', downloadHandler);
  }

  app.on('web-contents-created', (e, wc) => setupGuestDefaults(wc));

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (chromeByHost.size === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('toast:devtools', (e, guestId) => {
  const wc = webContents.fromId(guestId);
  if (wc) wc.toggleDevTools();
});

// ---- pill chrome IPC ----

ipcMain.on('toast:pill-state', (e, state) => {
  const host = BrowserWindow.fromWebContents(e.sender);
  if (!host) return;
  pillState.set(host.id, state);
  const c = chromeByHost.get(host.id);
  if (c && c.pill && !c.pill.isDestroyed()) {
    if (state.hidden) {
      if (c.pill.isVisible()) c.pill.hide();
    } else if (!c.pill.isVisible()) {
      c.pill.showInactive();
    }
    c.pill.webContents.send('pill:state', state);
  }
});

ipcMain.handle('toast:settings-get', () => readSettings());

ipcMain.on('toast:settings-set', (e, patch) => {
  const s = writeSettings(patch);
  const host = BrowserWindow.fromWebContents(e.sender);
  if (host) host.webContents.send('toast:settings', s);
});

// keyboard focus lives on the embedder: focusing the host webContents
// re-focuses its active element (the <webview>), which forwards into the
// guest. Focusing the guest's webContents directly leaves every document
// blurred.
ipcMain.on('toast:focus-host', (e, guestId) => {
  const host = BrowserWindow.fromWebContents(e.sender);
  if (host) host.webContents.focus();
  const guest = guestId ? webContents.fromId(guestId) : null;
  if (guest && !guest.isDestroyed()) guest.focus();
});

ipcMain.on('toast:switcher', (e, { open }) => {
  const host = BrowserWindow.fromWebContents(e.sender);
  const c = host ? chromeByHost.get(host.id) : null;
  if (c) c.switcher = !!open;
});

ipcMain.on('toast:pill-request', (e) => {
  const child = BrowserWindow.fromWebContents(e.sender);
  const host = child ? hostByChild.get(child.id) : null;
  if (!host) return;
  const state = pillState.get(host.id);
  if (state && !child.isDestroyed()) e.sender.send('pill:state', state);
});

ipcMain.on('toast:pill-intent', (e, intent) => {
  const win = BrowserWindow.fromWebContents(e.sender);
  if (!win) return;
  const host = asHost(win);
  host.webContents.send('toast:pill-intent', intent);
  // Enter/Esc hand key-focus back to the page (undims the traffic lights);
  // 'blur' must not refocus — the user deliberately clicked away
  if (intent.type === 'navigate' || intent.type === 'cancel') {
    host.focus();
  }
});

ipcMain.on('toast:pill-size', (e, { width, height }) => {
  const child = BrowserWindow.fromWebContents(e.sender);
  const host = child ? hostByChild.get(child.id) : null;
  if (!host || child.isDestroyed()) return;
  positionPill(host, width, height);
});

ipcMain.on('toast:pill-focus', (e, focused) => {
  const host = BrowserWindow.fromWebContents(e.sender);
  const c = host ? chromeByHost.get(host.id) : null;
  if (!focused || !c || !c.pill || c.pill.isDestroyed()) return;
  c.pill.focus();
  c.pill.webContents.send('pill:focus');
});
