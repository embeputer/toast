const {
  app,
  BrowserWindow,
  Menu,
  ipcMain,
  protocol,
  session,
  webContents,
  clipboard,
} = require('electron');
const path = require('path');
const fs = require('fs');

const START_URL = 'toast://newtab/';

protocol.registerSchemesAsPrivileged([
  {
    scheme: 'toast',
    privileges: { standard: true, secure: true, supportFetchAPI: false },
  },
]);

function hostWindow(guest) {
  // a <webview> guest's embedder is the window's own webContents
  const host = guest.hostWebContents;
  return host ? BrowserWindow.fromWebContents(host) : null;
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

  win.loadFile(path.join(__dirname, 'chrome', 'index.html'));
  win.webContents.once('did-finish-load', () => {
    win.webContents.focus();
    win.webContents.send('toast:event', 'focus-url');
  });
  return win;
}

function buildMenu() {
  const isMac = process.platform === 'darwin';
  const send = (name, arg) => (menuItem, win) => {
    const target = win || BrowserWindow.getFocusedWindow();
    if (target) {
      target.webContents.focus();
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
        { label: 'Focus Address Bar', accelerator: 'CmdOrCtrl+L', click: send('focus-url') },
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
        { label: 'Next Tab', accelerator: 'Ctrl+Tab', click: send('next-tab') },
        { label: 'Previous Tab', accelerator: 'Ctrl+Shift+Tab', click: send('prev-tab') },
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
  wc.setWindowOpenHandler(({ url }) => {
    win.webContents.send('toast:event', 'open-in-new-tab', url);
    return { action: 'deny' };
  });
}

app.whenReady().then(() => {
  app.setName('Toast');

  protocol.handle('toast', () => {
    const file = path.join(__dirname, 'newtab.html');
    return new Response(fs.readFileSync(file), {
      headers: { 'content-type': 'text/html; charset=utf-8' },
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
  const downloadHandler = (e, item) => {
    item.setSavePath(path.join(app.getPath('downloads'), item.getFilename()));
  };
  for (const ses of [session.defaultSession, session.fromPartition('persist:webview')]) {
    ses.setPermissionRequestHandler(permissionHandler);
    ses.on('will-download', downloadHandler);
  }

  app.on('web-contents-created', (e, wc) => setupGuestDefaults(wc));

  buildMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

ipcMain.on('toast:devtools', (e, guestId) => {
  const wc = webContents.fromId(guestId);
  if (wc) wc.toggleDevTools();
});
