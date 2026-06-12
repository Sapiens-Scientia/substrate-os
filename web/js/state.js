// Substrate OS — shared state (contract §7) + toast helper.

import { bus } from './bus.js';

export const state = {
  root: null,           // absolute path string
  tree: null,           // root TreeNode (§8)
  disk: null,           // {total, free, used, mount}
  selection: new Set(), // absolute paths
  layer: 'filespace',
  metas: new Map(),     // path -> string[] states
  proposals: [],        // open proposals
};

export function setLayer(layer) {
  if (layer !== 'filespace' && layer !== 'workspace') return;
  state.layer = layer;
  const app = document.getElementById('app');
  if (app) app.dataset.layer = layer;
  const toggle = document.getElementById('layer-toggle');
  if (toggle) {
    for (const btn of toggle.querySelectorAll('button[data-layer]')) {
      btn.classList.toggle('active', btn.dataset.layer === layer);
    }
  }
  applyDepthDim(layer);
  bus.emit('layer:changed', { layer });
}

// §4 depth effect: dim/blur #filespace behind the Workspace. The CSS rule
// (#app[data-layer="workspace"] #filespace) defines the end-state, but its
// opacity/filter *transition* unreliably latches at currentTime 0 because the
// filespace canvas repaints every frame and starves the transition. Drive the
// dim with the Web Animations API (fill:forwards) so it always completes; the
// data-layer flip remains the single trigger. WAAPI runs on the compositor and
// is immune to the main-thread paint starvation that stalled the CSS version.
let _dimAnim = null;
let _dimLayer = 'filespace';
const DIM_ON = { opacity: '0.12', filter: 'blur(6px) saturate(0.6)' };
const DIM_OFF = { opacity: '1', filter: 'blur(0px) saturate(1)' };
function applyDepthDim(layer) {
  if (layer === _dimLayer) return; // no real change → no spurious flash
  _dimLayer = layer;
  const fs = document.getElementById('filespace');
  if (!fs) return;
  const to = layer === 'workspace' ? DIM_ON : DIM_OFF;
  const from = layer === 'workspace' ? DIM_OFF : DIM_ON;
  if (typeof fs.animate !== 'function') {
    fs.style.opacity = to.opacity;
    fs.style.filter = to.filter;
    return;
  }
  if (_dimAnim) { _dimAnim.cancel(); _dimAnim = null; }
  try {
    _dimAnim = fs.animate([from, to], { duration: 280, easing: 'ease', fill: 'forwards' });
  } catch {
    fs.style.opacity = to.opacity;
    fs.style.filter = to.filter;
  }
}

export function setSelection(paths) {
  state.selection = new Set(paths || []);
  emitSelection();
}

export function toggleSelection(path) {
  if (state.selection.has(path)) state.selection.delete(path);
  else state.selection.add(path);
  emitSelection();
}

export function clearSelection() {
  state.selection.clear();
  emitSelection();
}

function emitSelection() {
  bus.emit('selection:changed', { paths: [...state.selection] });
}

export function nodeByPath(path) {
  if (!state.tree || typeof path !== 'string' || !path) return null;
  const walk = (node) => {
    if (node.path === path) return node;
    if (!node.children) return null;
    for (const child of node.children) {
      if (path === child.path || path.startsWith(child.path + '/')) {
        const hit = walk(child);
        if (hit) return hit;
      }
    }
    return null;
  };
  return walk(state.tree);
}

// --- theme -------------------------------------------------------------------
// index.html applies the saved/system theme pre-paint; these helpers switch it
// at runtime. Canvas renderers listen for theme:changed to re-sample CSS vars.

export function currentTheme() {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

export function setTheme(theme) {
  if (theme !== 'light' && theme !== 'dark') return;
  document.documentElement.dataset.theme = theme;
  try { localStorage.setItem('substrate-theme', theme); } catch { /* private mode */ }
  bus.emit('theme:changed', { theme });
}

// --- toast -----------------------------------------------------------------
// Exported here AND attached as window.__toast so any module can call it
// without an import dependency on this file.

export function toast(msg) {
  const tray = document.getElementById('toast-tray');
  if (!tray) return;
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = String(msg);
  tray.appendChild(el);
  while (tray.children.length > 5) tray.firstElementChild.remove();
  requestAnimationFrame(() => el.classList.add('show'));
  setTimeout(() => {
    el.classList.remove('show');
    el.classList.add('hide');
    setTimeout(() => el.remove(), 420);
  }, 3200);
}

if (typeof window !== 'undefined') window.__toast = toast;
