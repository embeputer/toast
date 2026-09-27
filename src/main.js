const {
  app,
  BrowserWindow,
  WebContentsView,
  Menu,
  ipcMain,
  protocol,
  session,
} = require('electron');
const path = require('path');
const fs = require('fs');

const TOOLBAR_HEIGHT = 52;
const SIDEBAR_WIDTH = 248;
const START_URL = 'toast://newtab/';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'toast',
    privileges: { standard: true, secure: true, supportFetchAPI: false },
  },
]);

// Per-window state: { tabs: Map<number, tab>, activeId, sidebarOpen, nextTabSeq }
const windows = new Map();

function windowState(win) {
  return windows.get(win);
}

function windowForWebContents(wc) {
  return BrowserWindow.fromWebContents(wc);
}

function serializeTab(tab) {
  const wc = tab.view.webContents;
  return {
    id: tab.id,
    title: tab.title || 'Untitled',
    url: tab.url,
    displayUrl: displayUrl(tab.url),
    favicon: tab.favicon,
    loading: wc.isLoading(),
    canGoBack: wc.navigationHistory.canGoBack(),
    canGoForward: wc.navigationHistory.canGoForward(),
  };
}

function displayUrl(url) {
  if (!url || url.startsWith(START_URL)) return '';
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function pushState(win) {
  if (win.isDestroyed()) return;
  const st = windowState(win);
  const tabs = [...st.tabs.values()].map(serializeTab);
  win.webContents.send('toast:state', {
    tabs,
    activeId: st.activeId,
    sidebarOpen: st.sidebarOpen,
  });
}

function layout(win) {
  const st = windowState(win);
  const active = st.tabs.get(st.activeId);
  if (!active) return;
  const [w, h] = win.getContentSize();
  const x = st.sidebarOpen ? SIDEBAR_WIDTH : 0;
  active.view.setBounds({
    x,
    y: TOOLBAR_HEIGHT,
    width: w - x,
    height: h - TOOLBAR_HEIGHT,
  });
}

function normalizeInput(input) {
  const s = input.trim();
  if (!s) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s; // has a scheme already
  if (/^localhost(:\d+)?([/?#]|$)/.test(s) || (/^[^\s]+\.[^\s]{2,}$/.test(s) && !/\s/.test(s))) {
    return `https://${s}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

function attachTabListeners(win, tab) {
  const wc = tab.view.webContents;
  const sync = () => pushState(win);

  wc.on('page-title-updated', (e, title) => {
    tab.title = title;
    sync();
  });
  wc.on('page-favicon-updated', (e, favicons) => {
    tab.favicon = favicons[0] || null;
    sync();
  });
  const urlChanged = (url) => {
    tab.url = url;
    sync();
  };
  wc.on('did-navigate', (e, url) => {
    urlChanged(url);
    // a fresh newtab steals focus back once its view finishes loading —
    // hand it to the address pill instead, like Safari's new tab
    const st = windowState(win);
    if (st && st.activeId === tab.id && url.startsWith(START_URL)) {
      win.webContents.focus();
      win.webContents.send('toast:event', 'focus-url');
    }
  });
  wc.on('did-navigate-in-page', (e, url) => urlChanged(url));
  wc.on('did-redirect-navigation', (e, url) => urlChanged(url));
  wc.on('did-start-loading', sync);
  wc.on('did-stop-loading', sync);
  wc.on('did-fail-load', (e, code, desc, url, isMainFrame) => {
    if (isMainFrame && code !== -3) {
      tab.url = url;
      tab.title = `Failed to load`;
    }
    sync();
  });

  wc.on('context-menu', (e, params) => {
    const items = [];
    items.push({
      label: 'Back',
      enabled: wc.navigationHistory.canGoBack(),
      click: () => wc.navigationHistory.goBack(),
    });
    items.push({
      label: 'Forward',
      enabled: wc.navigationHistory.canGoForward(),
      click: () => wc.navigationHistory.goForward(),
    });
    items.push({ label: 'Reload', click: () => wc.reload() });
    items.push({ type: 'separator' });
    if (params.linkURL) {
      items.push({
        label: 'Open Link in New Tab',
        click: () => createTab(win, params.linkURL, { activate: true }),
      });
      items.push({
        label: 'Copy Link',
        click: () => require('electron').clipboard.writeText(params.linkURL),
      });
    }
    if (params.isEditable) {
      items.push({ role: 'cut' }, { role: 'copy' }, { role: 'paste' });
    } else if (params.selectionText) {
      items.push({ role: 'copy' });
    }
    items.push({ type: 'separator' });
    items.push({ role: 'selectAll' });
    items.push({ type: 'separator' });
    items.push({
      label: 'Inspect Element',
      click: () => wc.inspectElement(params.x, params.y),
    });
    Menu.buildFromTemplate(items).popup({ window: win });
  });

  wc.setWindowOpenHandler(({ url }) => {
    createTab(win, url, { activate: true });
    return { action: 'deny' };
  });
}

function createTab(win, url, { activate = true } = {}) {
  const st = windowState(win);
  const view = new WebContentsView({
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });
  const tab = {
    id: st.nextTabSeq++,
    view,
    url: '',
    title: 'New Tab',
    favicon: null,
  };
  st.tabs.set(tab.id, tab);
  attachTabListeners(win, tab);
  if (activate) activateTab(win, tab.id);
  const target = url || START_URL;
  view.webContents.loadURL(target).catch(() => {});
  pushState(win);
  return tab;
}

function activateTab(win, id) {
  const st = windowState(win);
  if (st.activeId === id || !st.tabs.has(id)) return;
  const prev = st.tabs.get(st.activeId);
  if (prev) win.contentView.removeChildView(prev.view);
  st.activeId = id;
  const tab = st.tabs.get(id);
  win.contentView.addChildView(tab.view);
  layout(win);
  pushState(win);
  if (!tab.url || tab.url.startsWith(START_URL)) {
    win.webContents.focus();
    win.webContents.send('toast:event', 'focus-url');
  } else {
    tab.view.webContents.focus();
  }
}

function closeTab(win, id) {
  const st = windowState(win);
  const tab = st.tabs.get(id);
  if (!tab) return;
  if (st.activeId === id) {
    const ids = [...st.tabs.keys()];
    const idx = ids.indexOf(id);
    const neighbor = ids[idx + 1] ?? ids[idx - 1];
    if (neighbor === undefined) {
      win.close();
      return;
    }
    activateTab(win, neighbor);
  }
  try {
    win.contentView.removeChildView(tab.view);
  } catch {}
  tab.view.webContents.close();
  st.tabs.delete(id);
  pushState(win);
}

function stepTab(win, dir) {
  const st = windowState(win);
  const ids = [...st.tabs.keys()];
  if (ids.length < 2) return;
  const idx = ids.indexOf(st.activeId);
  const next = ids[(idx + dir + ids.length) % ids.length];
  activateTab(win, next);
}

function activeWebContents(win) {
  const st = windowState(win);
  const tab = st.tabs.get(st.activeId);
  return tab ? tab.view.webContents : null;
}

function toggleSidebar(win) {
  const st = windowState(win);
  st.sidebarOpen = !st.sidebarOpen;
  layout(win);
  pushState(win);
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 560,
    minHeight: 360,
    title: 'Toast',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 19 },
    backgroundColor: '#f5f4f2',
    vibrancy: 'under-window',
    visualEffectState: 'active',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
    },
  });

  windows.set(win, { tabs: new Map(), activeId: null, sidebarOpen: false, nextTabSeq: 1 });

  win.on('resize', () => layout(win));
  win.on('closed', () => {
    const st = windowState(win);
    for (const tab of st.tabs.values()) {
      try {
        tab.view.webContents.close();
      } catch {}
    }
    windows.delete(win);
  });

  win.loadFile(path.join(__dirname, 'chrome', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.focus();
    win.webContents.send('toast:event', 'focus-url');
  });
  createTab(win, START_URL, { activate: true });
  return win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (channel, ...args) => (menuItem, win) => {
    const target = win || BrowserWindow.getFocusedWindow();
    if (target) {
      target.webContents.focus();
      target.webContents.send(channel, ...args);
    }
  };
  const withWin = (fn) => (menuItem, win) => {
    const target = win || BrowserWindow.getFocusedWindow();
    if (target) fn(target);
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
        { label: 'New Tab', accelerator: 'CmdOrCtrl+T', click: withWin((w) => createTab(w, START_URL)) },
        { label: 'New Window', accelerator: 'CmdOrCtrl+N', click: () => createWindow() },
        {
          label: 'Close Tab',
          accelerator: 'CmdOrCtrl+W',
          click: withWin((w) => closeTab(w, windowState(w).activeId)),
        },
        { type: 'separator' },
        ...(isMac ? [] : [{ role: 'quit' }]),
        ...(isMac ? [{ role: 'close' }] : []),
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
        { label: 'Reload', accelerator: 'CmdOrCtrl+R', click: withWin((w) => activeWebContents(w)?.reload()) },
        {
          label: 'Force Reload',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: withWin((w) => activeWebContents(w)?.reloadIgnoringCache()),
        },
        { type: 'separator' },
        {
          label: 'Toggle Sidebar',
          accelerator: 'CmdOrCtrl+Shift+L',
          click: withWin(toggleSidebar),
        },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        {
          label: 'Toggle Developer Tools',
          accelerator: 'Alt+CmdOrCtrl+I',
          click: withWin((w) => activeWebContents(w)?.toggleDevTools()),
        },
        { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'History',
      submenu: [
        {
          label: 'Back',
          accelerator: 'CmdOrCtrl+[',
          click: withWin((w) => {
            const wc = activeWebContents(w);
            if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
          }),
        },
        {
          label: 'Forward',
          accelerator: 'CmdOrCtrl+]',
          click: withWin((w) => {
            const wc = activeWebContents(w);
            if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
          }),
        },
      ],
    },
    {
      label: 'Tabs',
      submenu: [
        {
          label: 'Next Tab',
          accelerator: 'Ctrl+Tab',
          click: withWin((w) => stepTab(w, 1)),
        },
        {
          label: 'Previous Tab',
          accelerator: 'Ctrl+Shift+Tab',
          click: withWin((w) => stepTab(w, -1)),
        },
        {
          label: 'Next Tab',
          accelerator: 'CmdOrCtrl+Shift+]',
          visible: false,
          click: withWin((w) => stepTab(w, 1)),
        },
        {
          label: 'Previous Tab',
          accelerator: 'CmdOrCtrl+Shift+[',
          visible: false,
          click: withWin((w) => stepTab(w, -1)),
        },
        { type: 'separator' },
        ...Array.from({ length: 9 }, (_, i) => ({
          label: `Tab ${i + 1}`,
          accelerator: `CmdOrCtrl+${i + 1}`,
          visible: false,
          click: withWin((w) => {
            const ids = [...windowState(w).tabs.keys()];
            if (ids[i] !== undefined) activateTab(w, ids[i]);
          }),
        })),
      ],
    },
    {
      label: 'Window',
      role: 'windowMenu',
    },
  ];

  const viewMenu = template.find((m) => m.label === 'View');
  viewMenu.submenu.splice(2, 0, {
    label: 'Focus Address Bar',
    accelerator: 'CmdOrCtrl+L',
    click: send('toast:event', 'focus-url'),
  });

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  app.setName('Toast');

  protocol.handle('toast', (req) => {
    const file = path.join(__dirname, 'newtab.html');
    return new Response(fs.readFileSync(file), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
    });
  });

  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => {
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
  });

  session.defaultSession.on('will-download', (e, item) => {
    item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
  });

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

// Chrome UI IPC
ipcMain.on('toast:navigate', (e, input) => {
  const win = windowForWebContents(e.sender);
  if (!win) return;
  const url = normalizeInput(input);
  const wc = activeWebContents(win);
  if (url && wc) {
    wc.loadURL(url).catch(() => {});
    wc.focus();
  }
});
ipcMain.on('toast:new-tab', (e) => {
  const win = windowForWebContents(e.sender);
  if (win) createTab(win, START_URL);
});
ipcMain.on('toast:close-tab', (e, id) => {
  const win = windowForWebContents(e.sender);
  if (win) closeTab(win, id);
});
ipcMain.on('toast:activate-tab', (e, id) => {
  const win = windowForWebContents(e.sender);
  if (win) activateTab(win, id);
});
ipcMain.on('toast:back', (e) => {
  const win = windowForWebContents(e.sender);
  const wc = win && activeWebContents(win);
  if (wc?.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
});
ipcMain.on('toast:forward', (e) => {
  const win = windowForWebContents(e.sender);
  const wc = win && activeWebContents(win);
  if (wc?.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
});
ipcMain.on('toast:reload', (e) => {
  const win = windowForWebContents(e.sender);
  activeWebContents(win)?.reload();
});
ipcMain.on('toast:stop', (e) => {
  const win = windowForWebContents(e.sender);
  activeWebContents(win)?.stop();
});
ipcMain.on('toast:toggle-sidebar', (e) => {
  const win = windowForWebContents(e.sender);
  if (win) toggleSidebar(win);
});
