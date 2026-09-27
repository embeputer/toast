const input = document.getElementById('url-input');
const favicon = document.getElementById('favicon');
const progress = document.getElementById('progress');
const pill = document.getElementById('url-pill');
const reloadBtn = document.getElementById('reload-btn');
const reloadIcon = document.getElementById('reload-icon');
const sidebar = document.getElementById('sidebar');
const tabList = document.getElementById('tab-list');
const sidebarClose = document.getElementById('sidebar-close');
const sidebarNewTab = document.getElementById('sidebar-new-tab');

const RELOAD_PATH =
  'M8 2.5a5.5 5.5 0 1 1-5.32 4.11.55.55 0 0 1 1.06.29A4.4 4.4 0 1 0 8 3.6v1.7L5.4 3.35 8 .4v2.1Z';
const STOP_PATH = 'M3.5 3.5l9 9M12.5 3.5l-9 9';

let state = { tabs: [], activeId: null, sidebarOpen: false };
let wasLoading = false;

function activeTab() {
  return state.tabs.find((t) => t.id === state.activeId) || null;
}

function renderPill() {
  const tab = activeTab();
  const loading = !!tab?.loading;

  if (document.activeElement !== input) {
    input.value = tab ? tab.displayUrl : '';
  }

  if (tab && tab.favicon) {
    favicon.src = tab.favicon;
    favicon.style.display = '';
  } else {
    favicon.removeAttribute('src');
    favicon.style.display = 'none';
  }

  reloadIcon.setAttribute('d', loading ? STOP_PATH : RELOAD_PATH);
  reloadIcon.setAttribute(
    'fill',
    loading ? 'none' : 'currentColor'
  );
  if (loading) {
    reloadIcon.setAttribute('stroke', 'currentColor');
    reloadIcon.setAttribute('stroke-width', '1.4');
    reloadIcon.setAttribute('stroke-linecap', 'round');
  } else {
    reloadIcon.removeAttribute('stroke');
    reloadIcon.removeAttribute('stroke-width');
    reloadIcon.removeAttribute('stroke-linecap');
  }

  // progress fill
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

function renderSidebar() {
  sidebar.hidden = !state.sidebarOpen;
  tabList.innerHTML = '';
  for (const tab of state.tabs) {
    const row = document.createElement('button');
    row.className = 'tab-row' + (tab.id === state.activeId ? ' active' : '');
    row.addEventListener('click', () => toast.send('toast:activate-tab', tab.id));

    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    if (tab.favicon) img.src = tab.favicon;
    row.appendChild(img);

    const title = document.createElement('span');
    title.className = 'tab-title';
    title.textContent = tab.displayUrl ? tab.title || tab.displayUrl : 'New Tab';
    row.appendChild(title);

    if (tab.loading) {
      const spinner = document.createElement('span');
      spinner.className = 'tab-loading';
      row.appendChild(spinner);
    }

    const close = document.createElement('span');
    close.className = 'tab-close';
    close.textContent = '×';
    close.addEventListener('click', (e) => {
      e.stopPropagation();
      toast.send('toast:close-tab', tab.id);
    });
    row.appendChild(close);

    tabList.appendChild(row);
  }
}

function render() {
  renderPill();
  renderSidebar();
}

input.addEventListener('focus', () => {
  const tab = activeTab();
  const url = tab && tab.url && !tab.url.startsWith('toast:') ? tab.url : '';
  input.value = url;
  // defer past the click so the whole field ends up selected
  setTimeout(() => {
    if (document.activeElement === input) input.select();
  }, 0);
});

input.addEventListener('blur', () => {
  renderPill();
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const v = input.value;
    input.blur();
    toast.send('toast:navigate', v);
  } else if (e.key === 'Escape') {
    input.blur();
    renderPill();
  }
});

reloadBtn.addEventListener('click', () => {
  const tab = activeTab();
  toast.send(tab && tab.loading ? 'toast:stop' : 'toast:reload');
});

sidebarClose.addEventListener('click', () => toast.send('toast:toggle-sidebar'));
sidebarNewTab.addEventListener('click', () => toast.send('toast:new-tab'));

toast.on('toast:state', (s) => {
  state = s;
  render();
});

toast.on('toast:event', (name) => {
  if (name === 'focus-url') {
    input.focus();
    input.select();
  }
});
