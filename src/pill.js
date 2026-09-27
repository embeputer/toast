// Renderer for the floating pill window (real NSGlassEffectView sits behind it).
// Renders state pushed from the main-window chrome; sends user intents back.

const pill = document.getElementById('pill');
const label = document.getElementById('tab-label');
const favicon = document.getElementById('favicon');
const titleEl = document.getElementById('tab-title');
const input = document.getElementById('url-input');
const progress = document.getElementById('progress');

const REST_MIN_W = 140;
const REST_MAX_W = 400;
const REST_H = 30;
const REST_PAD = 24;
const EDIT_W = 520;
const EDIT_H = 36;

let state = { title: 'New Tab', favicon: '', url: '', loading: false, editing: false };
let lastSentW = 0, lastSentH = 0;

function desiredSize() {
  if (state.editing) return { w: EDIT_W, h: EDIT_H };
  const w = Math.min(REST_MAX_W, Math.max(REST_MIN_W, label.scrollWidth + REST_PAD));
  return { w: Math.round(w), h: REST_H };
}

function requestSize() {
  const { w, h } = desiredSize();
  if (w === lastSentW && h === lastSentH) return;
  lastSentW = w; lastSentH = h;
  toast.send('toast:pill-size', { width: w, height: h });
}

function render() {
  document.body.classList.toggle('editing', state.editing);
  titleEl.textContent = state.title || 'New Tab';
  favicon.src = state.favicon || '';
  if (!state.editing) input.value = '';
  progress.style.width = state.loading ? '65%' : '0%';
  requestSize();
}

function commitEdit() {
  const v = input.value.trim();
  toast.send('toast:pill-intent', { type: 'navigate', url: v });
}

pill.addEventListener('click', () => {
  if (state.editing) return;
  toast.send('toast:pill-intent', { type: 'edit' });
});

input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') commitEdit();
  else if (e.key === 'Escape') toast.send('toast:pill-intent', { type: 'cancel' });
  e.stopPropagation();
});

// Window losing focus (click on the page, menu, another window) exits edit mode.
window.addEventListener('blur', () => {
  if (state.editing) toast.send('toast:pill-intent', { type: 'blur' });
});

toast.on('pill:init', ({ glass }) => {
  document.body.classList.toggle('no-glass', !glass);
});

toast.on('pill:state', (s) => {
  const wasEditing = state.editing;
  state = Object.assign(state, s);
  render();
  if (state.editing && !wasEditing) {
    input.value = s.url || '';
  }
});

toast.on('pill:focus', () => {
  input.value = state.url || '';
  input.focus();
  setTimeout(() => input.select(), 0);
});

toast.send('toast:pill-request');
render();
