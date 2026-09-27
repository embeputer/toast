const webviewsEl = document.getElementById('webviews');
const pill = document.getElementById('url-pill');
const favicon = document.getElementById('favicon');
const tabTitle = document.getElementById('tab-title');
const input = document.getElementById('url-input');
const progress = document.getElementById('progress');

const START_URL = 'toast://newtab/';
const tabs = [];
let activeId = null;
let seq = 0;
let wasLoading = false;

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

function renderPill() {
  const tab = activeTab();
  if (!pill.classList.contains('editing')) {
    tabTitle.textContent = tab ? tab.title || 'New Tab' : 'New Tab';
  }
  if (tab && tab.favicon) {
    favicon.src = tab.favicon;
    favicon.style.display = '';
  } else {
    favicon.removeAttribute('src');
    favicon.style.display = 'none';
  }

  const loading = !!(tab && tab.loading);
  if (loading && !wasLoading) {
    progress.style.opacity = '1';
    progress.style.transition = 'none';
    progress.style.width = '0';
    requestAnimationFrame(() => {
      progress.style.transition = 'width 6s cubic-bezier(0.1,0.5,0.2,1)';
      progress.style.width = '82%';
    });
  } else if (!loading && wasLoading) {
    progress.style.transition = 'width 0.18s ease';
    progress.style.width = '100%';
    setTimeout(() => {
      progress.style.transition = 'opacity 0.35s ease';
      progress.style.opacity = '0';
      setTimeout(() => {
        progress.style.transition = 'none';
        progress.style.width = '0';
      }, 380);
    }, 200);
  }
  wasLoading = loading;
}

function attachViewListeners(tab) {
  const wv = tab.view;
  const sync = () => renderPill();

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
    if (tab.id === activeId && e.url.startsWith(START_URL)) enterEditMode();
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
  renderPill();
  if (!tab.url || tab.url.startsWith(START_URL)) {
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
  renderPill();
}

function stepTab(dir) {
  if (tabs.length < 2) return;
  const idx = tabs.findIndex((t) => t.id === activeId);
  const next = tabs[(idx + dir + tabs.length) % tabs.length];
  activateTab(next.id);
}

function enterEditMode() {
  const tab = activeTab();
  pill.classList.add('editing');
  input.hidden = false;
  input.value = tab && tab.url && !tab.url.startsWith(START_URL) ? tab.url : '';
  input.focus();
  setTimeout(() => {
    if (document.activeElement === input) input.select();
  }, 0);
}

function exitEditMode() {
  pill.classList.remove('editing');
  input.hidden = true;
  input.blur();
}

pill.addEventListener('click', (e) => {
  if (!pill.classList.contains('editing')) enterEditMode();
});

input.addEventListener('keydown', (e) => {
  const tab = activeTab();
  if (e.key === 'Enter') {
    const url = normalizeInput(input.value);
    exitEditMode();
    renderPill();
    if (url && tab) {
      tab.view.loadURL(url);
      tab.view.focus();
    }
  } else if (e.key === 'Escape') {
    exitEditMode();
    renderPill();
    if (tab) tab.view.focus();
  }
});

input.addEventListener('blur', () => {
  if (pill.classList.contains('editing')) {
    exitEditMode();
    renderPill();
  }
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

createTab(START_URL);
