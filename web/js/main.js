// Substrate OS — shell boot (contract §14).
// Boot: getRoot → getDisk → getTree → emit tree:updated/disk:updated →
// init modules → connectEvents → getProposals → key bindings.

import { bus } from './bus.js';
import { state, setLayer, clearSelection, toast, setTheme, currentTheme } from './state.js';
import * as api from './api.js';
import { initFilespace } from './filespace.js';
import { initWorkspace, openWindow } from './workspace.js';
import { initEffectors } from './effectors.js';
import { initComms } from './comms.js';

function wireLayerToggle() {
  const toggle = document.getElementById('layer-toggle');
  toggle.addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-layer]');
    if (btn) setLayer(btn.dataset.layer);
  });
}

function wireThemeToggle() {
  const btn = document.getElementById('theme-btn');
  if (!btn) return;
  const glyph = () => { btn.textContent = currentTheme() === 'light' ? '☀' : '☾'; };
  glyph();
  btn.addEventListener('click', () => {
    setTheme(currentTheme() === 'light' ? 'dark' : 'light');
    glyph();
  });
}

function wireKeys() {
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Tab') {
      const t = e.target;
      const editing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      if (editing) return; // don't steal Tab from text entry
      e.preventDefault();
      setLayer(state.layer === 'filespace' ? 'workspace' : 'filespace');
    } else if (e.key === 'Escape' && state.layer === 'filespace') {
      clearSelection(); // workspace handles its own Esc
    }
  });
}

// Keep the disk gauge honest: refresh disk stats shortly after fs activity.
function wireDiskRefresh() {
  let timer = null;
  bus.on('fs:changed', () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(async () => {
      timer = null;
      try {
        const disk = await api.getDisk();
        state.disk = disk;
        bus.emit('disk:updated', { disk });
      } catch (err) {
        console.error('disk refresh failed', err);
      }
    }, 1500);
  });
}

async function boot() {
  wireLayerToggle();
  wireThemeToggle();
  wireKeys();
  wireDiskRefresh();

  try {
    const { root } = await api.getRoot();
    state.root = root;

    const disk = await api.getDisk();
    state.disk = disk;

    const tree = await api.getTree();
    state.tree = tree;

    bus.emit('tree:updated', { tree });
    bus.emit('disk:updated', { disk });

    initFilespace(document.getElementById('filespace'));
    initWorkspace(document.getElementById('workspace'));
    initEffectors(document.getElementById('effector-panel'));
    initComms(document.getElementById('comms-strip'));

    // Re-emit so modules that subscribe (rather than read state) at init
    // still receive the initial data. Handlers are idempotent.
    bus.emit('tree:updated', { tree });
    bus.emit('disk:updated', { disk });

    api.connectEvents();

    const res = await api.getProposals();
    state.proposals = (res && res.proposals) || [];

    document.title = 'Substrate OS';
  } catch (err) {
    console.error('boot failed', err);
    toast(`boot failed — ${err.message}`);
  }
}

// openWindow is re-exported into scope so shell-level code (and the console)
// can open windows directly; workspace also listens on window:open.
window.__openWindow = (opts) => openWindow(opts);

boot();
