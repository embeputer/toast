const webviewsEl = document.getElementById('webviews');
const switcherEl = document.getElementById('switcher');
const switcherRow = document.getElementById('switcher-row');
const setupEl = document.getElementById('setup');
const enginesEl = document.getElementById('engines');
const dlToast = document.getElementById('dl-toast');

const ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q=' },
  brave: { name: 'Brave Search', url: 'https://search.brave.com/search?q=' },
};

let settings = {};

const START_URL = 'toast://newtab/';
function newtabUrl() {
  const e = settings.engine || 'google';
  return `${START_URL}?e=${e}`;
}
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
  if (/^chrome:\/\//i.test(s)) return `toast://${s.slice('chrome://'.length)}`;
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(s)) return s;
  if (/^localhost(:\d+)?([/?#]|$)/.test(s) || (/^[^\s]+\.[^\s]{2,}$/.test(s) && !/\s/.test(s))) {
    return `https://${s}`;
  }
  return `${(ENGINES[settings.engine] || ENGINES.google).url}${encodeURIComponent(s)}`;
}

function isNewtab(tab) {
  return !tab || !tab.url || tab.url.startsWith(START_URL);
}

// toast:// URLs that aren't our own pages load their chromium internal
// equivalent — chrome:// is an implementation detail, never shown
const TOAST_PAGES = new Set(['newtab', 'downloads', 'version']);
function toastHost(url) {
  const m = /^toast:\/\/([a-z-]+)/i.exec(url);
  return m ? m[1] : null;
}
function loadURL(wv, url) {
  const h = toastHost(url);
  if (h && !TOAST_PAGES.has(h)) {
    wv.loadURL(`chrome://${url.slice('toast://'.length)}`);
  } else {
    wv.loadURL(url);
  }
}

// ---- setup ----

function showSetup() {
  enginesEl.replaceChildren();
  for (const [id, eng] of Object.entries(ENGINES)) {
    const b = document.createElement('div');
    b.className = 'engine';
    b.textContent = eng.name;
    b.addEventListener('click', () => {
      settings.engine = id;
      toast.send('toast:settings-set', { engine: id });
      setupEl.hidden = true;
      // re-point any open new-tab pages at the chosen engine
      for (const t of tabs) if (isNewtab(t)) t.view.loadURL(newtabUrl());
    });
    enginesEl.appendChild(b);
  }
  setupEl.hidden = false;
}

// The pill renders in its own glass window; we broadcast what to show.
// Hidden entirely on the new-tab page (which has its own search bar),
// unless the user explicitly opened it (⌘K / click).
function broadcastPill() {
  const tab = activeTab();
  toast.send('toast:pill-state', {
    title: tab ? tab.title || 'New Tab' : 'New Tab',
    favicon: (tab && tab.favicon) || '',
    url: tab && tab.url && !tab.url.startsWith(START_URL) ? tab.url : '',
    loading: !!(tab && tab.loading),
    editing,
    hidden: !editing && isNewtab(tab),
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
    // chrome:// internally loads the page, but the address is toast://
    tab.url = /^chrome:\/\//i.test(url) ? `toast://${url.slice('chrome://'.length)}` : url;
    sync();
  };
  wv.addEventListener('did-navigate', (e) => {
    urlChanged(e.url);
    if (tab.id === activeId && editing) exitEditMode();
    // fresh webview steals focus during load; hand it back so the
    // new-tab page's search field can take it
    if (e.url.startsWith(START_URL)) {
      focusGuest(wv);
      // keep the engine param fresh when a stale newtab reloads
      const want = newtabUrl();
      if (e.url !== want) loadURL(wv, want);
    } else if (toastHost(e.url) && !TOAST_PAGES.has(toastHost(e.url))) {
      // page-initiated toast://<page> nav — swap in the real chrome:// page
      // via a programmatic load (pages can't navigate to chrome:// directly)
      loadURL(wv, e.url);
    } else if (!toastHost(e.url)) {
      // page content begins below the floating pill/lights and scrolls
      // under them — no static bar needed
      wv.insertCSS('html{padding-top:56px !important;scroll-padding-top:56px !important}');
    }
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
  wv.addEventListener('dom-ready', () => {
    // re-focus after attach: focusing an already-active element is a no-op,
    // and the first focus ran before the guest frame existed
    if (tab.id === activeId) {
      wv.blur();
      wv.focus();
      toast.send('toast:focus-host', wv.getWebContentsId());
    }
  });
}

function createTab(url, { activate = true } = {}) {
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
  };
  attachViewListeners(tab);
  tabs.push(tab);
  webviewsEl.appendChild(wv);
  wv.setAttribute('src', url || newtabUrl());
  if (activate) activateTab(tab.id);
  return tab;
}

function focusGuest(wv) {
  wv.focus();
  try {
    toast.send('toast:focus-host', wv.getWebContentsId());
  } catch (_) {}
}

function activateTab(id) {
  const tab = tabs.find((t) => t.id === id);
  if (!tab) return;
  const prev = activeTab();
  // a focused webview holds renderer frame focus — release it or the new
  // tab's page never receives key events
  if (prev && prev.id !== id) prev.view.blur();
  activeId = id;
  for (const t of tabs) t.view.classList.toggle('inactive', t.id !== id);
  exitEditMode();
  broadcastPill();
  focusGuest(tab.view);
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

// ---- tab switcher ----

let switcherOpen = false;
let switcherSel = 0;
let switcherOriginId = null;

function renderSwitcher() {
  switcherRow.replaceChildren();
  tabs.forEach((t, i) => {
    const chip = document.createElement('div');
    chip.className = 'sw-chip' + (i === switcherSel ? ' selected' : '');
    if (t.favicon) {
      const img = document.createElement('img');
      img.src = t.favicon;
      chip.appendChild(img);
    }
    const span = document.createElement('span');
    span.textContent = t.title || 'New Tab';
    chip.appendChild(span);
    chip.addEventListener('click', () => {
      switcherSel = i;
      commitSwitcher();
    });
    switcherRow.appendChild(chip);
  });
}

function openSwitcher() {
  if (switcherOpen || tabs.length === 0) return;
  if (editing) exitEditMode();
  switcherOpen = true;
  switcherOriginId = activeId;
  switcherSel = Math.max(0, tabs.findIndex((t) => t.id === activeId));
  renderSwitcher();
  switcherEl.hidden = false;
  toast.send('toast:switcher', { open: true });
}

function closeSwitcher() {
  if (!switcherOpen) return;
  switcherOpen = false;
  switcherEl.hidden = true;
  toast.send('toast:switcher', { open: false });
}

function commitSwitcher() {
  const tab = tabs[switcherSel];
  closeSwitcher();
  if (tab) activateTab(tab.id);
}

function cancelSwitcher() {
  const origin = tabs.find((t) => t.id === switcherOriginId);
  closeSwitcher();
  if (origin) activateTab(origin.id);
}

// each step previews the tab live behind the overlay — releasing Ctrl just
// has to close the switcher, never decide anything
function stepSwitcher(dir) {
  switcherSel = (switcherSel + dir + tabs.length) % tabs.length;
  const tab = tabs[switcherSel];
  if (tab) activateTab(tab.id);
  renderSwitcher();
}

toast.on('toast:switcher-key', ({ key, shift }) => {
  if (!switcherOpen) return;
  if (key === 'ArrowRight' || (key === 'Tab' && !shift)) stepSwitcher(1);
  else if (key === 'ArrowLeft' || (key === 'Tab' && shift)) stepSwitcher(-1);
  else if (key === 'Enter') commitSwitcher();
  else if (key === 'Escape') cancelSwitcher();
});

toast.on('toast:switcher-commit', () => {
  if (switcherOpen) commitSwitcher();
});

// click the dimmed backdrop to dismiss without switching
switcherEl.addEventListener('click', (e) => {
  if (e.target === switcherEl) cancelSwitcher();
});

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
    case 'open-switcher':
      openSwitcher();
      break;
    case 'open-setup':
      showSetup();
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

toast.on('toast:settings', (s) => {
  settings = s;
});

let dlToastTimer = null;
function showToast(text) {
  dlToast.textContent = text;
  dlToast.hidden = false;
  clearTimeout(dlToastTimer);
  dlToastTimer = setTimeout(() => {
    dlToast.hidden = true;
  }, 3000);
}
toast.on('toast:notify', (text) => showToast(text));
toast.on('toast:download', ({ name, state }) => {
  const label =
    state === 'started'
      ? `Downloading ${name}…`
      : state === 'completed'
        ? `Downloaded ${name}`
        : state === 'cancelled'
          ? `Cancelled ${name}`
          : `Failed ${name}`;
  showToast(label);
});

(async () => {
  try {
    settings = await toast.invoke('toast:settings-get');
  } catch (_) {
    settings = {};
  }
  if (!settings.engine) showSetup();
  createTab();
  broadcastPill();
})();
