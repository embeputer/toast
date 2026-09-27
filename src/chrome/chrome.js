const webviewsEl = document.getElementById('webviews');

const START_URL = 'toast://newtab/';
const tabs = [];
let activeId = null;
let seq = 0;
let editing = false;

function activeTab() {
  return tabs.find((t) => t.id === activeId) || null;
}

function normalizeInput(value) {
  const s = value.trim();
  if (!s) return null;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
  if (/^localhost(:\d+)?([/?#]|$)/.test(s) || (/^[^\s]+\.[^\s]{2,}$/.test(s) && !/\s/.test(s))) {
    return `https://${s}`;
  }
  return `https://www.google.com/search?q=${encodeURIComponent(s)}`;
}

// The pill renders in its own glass window; we broadcast what to show.
function broadcastPill() {
  const tab = activeTab();
  toast.send('toast:pill-state', {
    title: tab ? tab.title || 'New Tab' : 'New Tab',
    favicon: (tab && tab.favicon) || '',
    url: tab && tab.url && !tab.url.startsWith(START_URL) ? tab.url : '',
    loading: !!(tab && tab.loading),
    editing,
  });
}

function enterEditMode() {
  if (editing) return;
  editing = true;
  broadcastPill();
  toast.send('toast:pill-focus', true);
}

function exitEditMode() {
  if (!editing) return;
  editing = false;
  broadcastPill();
}

function attachViewListeners(tab) {
  const wv = tab.view;
  const sync = () => broadcastPill();

  wv.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    sync();
  });
  wv.addEventListener('page-favicon-updated', (e) => {
    tab.favicon = e.favicons[0] || null;
    sync();
  });
  const urlChanged = (url) => {
    tab.url = url;
    sync();
  };
  wv.addEventListener('did-navigate', (e) => {
    urlChanged(e.url);
    if (tab.id === activeId && tab.autoEdit && e.url.startsWith(START_URL)) enterEditMode();
  });
  wv.addEventListener('did-navigate-in-page', (e) => urlChanged(e.url));
  wv.addEventListener('did-redirect-navigation', (e) => urlChanged(e.url));
  wv.addEventListener('did-start-loading', () => {
    tab.loading = true;
    sync();
  });
  wv.addEventListener('did-stop-loading', () => {
    tab.loading = false;
    sync();
  });
  wv.addEventListener('new-window', (e) => {
    createTab(e.url);
  });
}

function createTab(url, { activate = true, autoEdit = true } = {}) {
  const wv = document.createElement('webview');
  wv.className = 'page-view';
  wv.setAttribute('webpreferences', 'contextIsolation=yes,sandbox=yes');
  wv.setAttribute('allowpopups', 'false');
  const tab = {
    id: ++seq,
    view: wv,
    url: '',
    title: 'New Tab',
    favicon: null,
    loading: false,
    autoEdit,
  };
  attachViewListeners(tab);
  tabs.push(tab);
  webviewsEl.appendChild(wv);
  wv.setAttribute('src', url || START_URL);
  if (activate) activateTab(tab.id);
  return tab;
}

function activateTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  activeId = id;
  for (const t of tabs) t.view.classList.toggle('inactive', t.id !== id);
  exitEditMode();
  broadcastPill();
  if (tab.autoEdit && (!tab.url || tab.url.startsWith(START_URL))) {
    enterEditMode();
  } else {
    tab.view.focus();
  }
}

function closeTab(id) {
  const idx = tabs.findIndex((t) => t.id === id);
  if (idx === -1) return;
  if (tabs.length === 1) {
    window.close();
    return;
  }
  const [tab] = tabs.splice(idx, 1);
  tab.view.remove();
  if (activeId === id) {
    const neighbor = tabs[idx] || tabs[idx - 1];
    activateTab(neighbor.id);
  }
  broadcastPill();
}

function stepTab(dir) {
  if (tabs.length < 2) return;
  const idx = tabs.findIndex((t) => t.id === activeId);
  const next = tabs[(idx + dir + tabs.length) % tabs.length];
  activateTab(next.id);
}

toast.on('toast:event', (name, arg) => {
  const tab = activeTab();
  switch (name) {
    case 'focus-url':
      enterEditMode();
      break;
    case 'new-tab':
      createTab(START_URL);
      break;
    case 'open-in-new-tab':
      createTab(arg);
      break;
    case 'close-tab':
      if (tab) closeTab(tab.id);
      break;
    case 'back':
      if (tab && tab.view.canGoBack()) tab.view.goBack();
      if (tab) tab.view.focus();
      break;
    case 'forward':
      if (tab && tab.view.canGoForward()) tab.view.goForward();
      if (tab) tab.view.focus();
      break;
    case 'reload':
      if (tab) tab.view.reload();
      if (tab) tab.view.focus();
      break;
    case 'force-reload':
      if (tab) tab.view.reloadIgnoringCache();
      if (tab) tab.view.focus();
      break;
    case 'next-tab':
      stepTab(1);
      break;
    case 'prev-tab':
      stepTab(-1);
      break;
    case 'tab':
      if (tabs[arg]) activateTab(tabs[arg].id);
      break;
    case 'devtools':
      if (tab) toast.send('toast:devtools', tab.view.getWebContentsId());
      break;
  }
});

// Intents coming back from the pill window (click-to-edit, Enter, Esc, blur)
toast.on('toast:pill-intent', (intent) => {
  const tab = activeTab();
  switch (intent.type) {
    case 'edit':
      enterEditMode();
      break;
    case 'navigate': {
      exitEditMode();
      const url = normalizeInput(intent.url || '');
      if (url && tab) {
        tab.view.loadURL(url);
        tab.view.focus();
      }
      break;
    }
    case 'cancel':
      exitEditMode();
      if (tab) tab.view.focus();
      break;
    case 'blur':
      // pill window lost focus to the page — leave edit mode quietly
      if (editing) exitEditMode();
      break;
  }
});

// the launch tab opens on the new-tab page without grabbing edit focus
// (editing moves key-focus to the pill window, which would dim the traffic
// lights at startup)
createTab(START_URL, { autoEdit: false });
broadcastPill();
