// Substrate OS — Effector panel (Builder F)
// Implements contract §11: left panel tools, report windows, proposals, checkpoints, release.

import { bus } from './bus.js';
import { state, setLayer, setSelection, nodeByPath } from './state.js';
import * as api from './api.js';

const STALE_DAYS = 180;

const TOOLS = [
  { name: 'summarize', glyph: 'Σ', label: 'Summarize' },
  { name: 'classify', glyph: '◫', label: 'Classify' },
  { name: 'duplicates', glyph: '≡', label: 'Duplicates' },
  { name: 'stale', glyph: '⏳', label: 'Stale' },
  { name: 'rename', glyph: '✎', label: 'Rename' },
  { name: 'checkpoint', glyph: '◆', label: 'Checkpoint' },
  { name: 'release', glyph: '↥', label: 'Release' },
];

const NEEDS_SELECTION = new Set(['rename', 'checkpoint', 'release']);

const REPORT_TITLES = {
  summarize: 'Summary',
  classify: 'Classification',
  duplicates: 'Duplicates',
  stale: 'Stale files',
};

const btns = {};
const running = new Set();
const busyAnims = new Map();
let badgeEl = null;
let rootEl = null;
let readoutEl = null;
let releaseLabelEl = null;
let releaseArmed = false;
let releaseTimer = null;
let revealBtn = null;

// ---------------------------------------------------------------- helpers

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtBytes(n) {
  n = Number(n) || 0;
  if (n < 1024) return `${n} B`;
  const units = ['KB', 'MB', 'GB'];
  let u = -1;
  do { n /= 1024; u++; } while (n >= 1024 && u < units.length - 1);
  return `${n.toFixed(1)} ${units[u]}`;
}

function basename(p) {
  if (typeof p !== 'string' || !p) return '—';
  const parts = p.split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : '/';
}

function relPath(p) {
  if (typeof p !== 'string') return '';
  const root = state.root;
  if (root && (p === root || p.startsWith(root.endsWith('/') ? root : root + '/'))) {
    const r = p.slice(root.length).replace(/^\//, '');
    return r || basename(p);
  }
  return p;
}

function dateFmt(ms) {
  if (!Number.isFinite(ms)) return '—';
  return new Date(ms).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ageDays(mtime) {
  return Math.max(0, Math.floor((Date.now() - mtime) / 864e5));
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function errMsg(err) {
  return (err && err.message) ? err.message : String(err);
}

function toast(msg) {
  if (typeof window.__toast === 'function') { window.__toast(msg); return; }
  const tray = document.getElementById('toast-tray');
  if (!tray) return;
  const t = el('div', 'toast', msg);
  tray.appendChild(t);
  t.animate(
    [{ opacity: 0, transform: 'translateY(-6px)' }, { opacity: 1, transform: 'translateY(0)' }],
    { duration: 180, easing: 'ease-out' },
  );
  setTimeout(() => {
    const a = t.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 260, easing: 'ease-in' });
    a.onfinish = () => t.remove();
  }, 2400);
}

// ---------------------------------------------------------------- init

export function initEffectors(panelEl) {
  injectStyles();
  panelEl.textContent = '';

  const header = el('div', 'fx-header');
  header.append(el('div', 'fx-wordmark', 'SUBSTRATE'));
  rootEl = el('div', 'fx-root', '—');
  readoutEl = el('div', 'fx-selection empty', 'no selection');
  header.append(rootEl, readoutEl);
  panelEl.append(header);

  const tools = el('div', 'fx-tools');
  for (const t of TOOLS) {
    const b = el('button', 'fx-btn');
    b.type = 'button';
    b.dataset.fx = t.name;
    const glyph = el('span', 'fx-glyph', t.glyph);
    const label = el('span', 'fx-label', t.label);
    b.append(glyph, label);
    btns[t.name] = b;
    tools.append(b);

    if (t.name === 'release') {
      releaseLabelEl = label;
      b.addEventListener('click', onReleaseClick);
    } else if (t.name === 'rename') {
      b.addEventListener('click', () => { if (canRun('rename')) runRename(); });
    } else if (t.name === 'checkpoint') {
      b.addEventListener('click', () => { if (canRun('checkpoint')) runCheckpoint(); });
    } else {
      b.addEventListener('click', () => { if (canRun(t.name)) runReport(t.name); });
    }
  }
  panelEl.append(tools, el('div', 'fx-divider'));

  panelEl.append(buildAppsSection());
  panelEl.append(el('div', 'fx-divider'));

  const lib = el('div', 'fx-tools fx-lib');
  const propBtn = el('button', 'fx-btn');
  propBtn.type = 'button';
  propBtn.dataset.fx = 'proposals';
  propBtn.append(el('span', 'fx-glyph', '⧉'), el('span', 'fx-label', 'Proposals'));
  badgeEl = el('span', 'fx-badge', '0');
  badgeEl.style.display = 'none';
  propBtn.append(badgeEl);
  propBtn.addEventListener('click', openProposalsWindow);

  const cpBtn = el('button', 'fx-btn');
  cpBtn.type = 'button';
  cpBtn.dataset.fx = 'checkpoints';
  cpBtn.append(el('span', 'fx-glyph', '❖'), el('span', 'fx-label', 'Checkpoints'));
  cpBtn.addEventListener('click', openCheckpointsWindow);

  lib.append(propBtn, cpBtn);
  panelEl.append(lib);

  bus.on('selection:changed', () => { updateReadout(); updateEnabled(); });
  bus.on('tree:updated', () => { updateRoot(); updateReadout(); });
  bus.on('effector:busy', onBusy);
  bus.on('proposal:created', refreshProposals);
  bus.on('proposal:resolved', refreshProposals);

  updateRoot();
  updateReadout();
  updateEnabled();
  refreshProposals();
}

// ---------------------------------------------------------------- panel state

function updateRoot() {
  rootEl.textContent = state.root ? basename(state.root) : (state.tree?.name || '—');
}

function updateReadout() {
  const n = state.selection.size;
  if (!n) {
    readoutEl.textContent = 'no selection';
    readoutEl.classList.add('empty');
    return;
  }
  let bytes = 0;
  for (const p of state.selection) {
    const node = nodeByPath(p);
    if (node) bytes += node.size || 0;
  }
  readoutEl.textContent = `${plural(n, 'item')} · ${fmtBytes(bytes)}`;
  readoutEl.classList.remove('empty');
}

function updateEnabled() {
  const has = state.selection.size > 0;
  for (const name of NEEDS_SELECTION) {
    btns[name]?.classList.toggle('disabled', !has);
  }
  if (revealBtn) {
    revealBtn.classList.toggle('disabled', !has);
    revealBtn.disabled = !has;
  }
  if (!has && releaseArmed) disarmRelease();
}

function canRun(name) {
  const b = btns[name];
  return b && !b.classList.contains('disabled') && !running.has(name);
}

function setBusy(name, busy) {
  if (busy) running.add(name); else running.delete(name);
  bus.emit('effector:busy', { name, busy });
}

function onBusy({ name, busy }) {
  const b = btns[name];
  if (!b) return;
  if (busy) {
    b.classList.add('busy');
    if (!busyAnims.has(name)) {
      const a = b.animate(
        [{ opacity: 1 }, { opacity: 0.45 }, { opacity: 1 }],
        { duration: 900, iterations: Infinity, easing: 'ease-in-out' },
      );
      busyAnims.set(name, a);
    }
  } else {
    b.classList.remove('busy');
    busyAnims.get(name)?.cancel();
    busyAnims.delete(name);
  }
}

function targetPaths() {
  if (state.selection.size) return [...state.selection];
  return state.root ? [state.root] : [];
}

async function refreshProposals() {
  try {
    const res = await api.getProposals();
    state.proposals = (res.proposals || []).filter(p => !p.resolved);
  } catch { /* server unreachable — keep current list */ }
  updateBadge();
}

function updateBadge() {
  const n = state.proposals.length;
  badgeEl.textContent = String(n);
  badgeEl.style.display = n ? '' : 'none';
}

// ---------------------------------------------------------------- applications (v2 §16.2)
// Installed Mac apps act as effectors on the current selection. The list is
// fetched once at init; failures are swallowed so the panel never blocks.

function buildAppsSection() {
  const section = el('div', 'apps-section');

  const head = el('div', 'apps-head');
  head.append(el('span', 'apps-title', 'APPLICATIONS'));
  revealBtn = el('button', 'apps-reveal');
  revealBtn.type = 'button';
  revealBtn.append(el('span', 'apps-reveal-glyph', '⊙'), el('span', 'apps-reveal-label', 'Reveal in Finder'));
  revealBtn.disabled = true;
  revealBtn.classList.add('disabled');
  revealBtn.addEventListener('click', onRevealClick);
  head.append(revealBtn);
  section.append(head);

  const grid = el('div', 'apps-grid');
  const note = el('div', 'apps-note', 'loading apps…');
  grid.append(note);
  section.append(grid);

  loadApps(grid, note);
  return section;
}

async function loadApps(grid, note) {
  let apps = [];
  try {
    const res = await api.getApps();
    apps = Array.isArray(res?.apps) ? res.apps : [];
  } catch {
    note.remove();              // quiet: no apps row, no error spam
    return;
  }
  note.remove();
  if (!apps.length) return;
  for (const app of apps) {
    grid.append(buildAppChip(app));
  }
}

function buildAppChip(app) {
  const chip = el('button', 'app-chip');
  chip.type = 'button';
  chip.title = app.name || basename(app.path);

  const iconWrap = el('span', 'app-icon-wrap');
  if (app.icon) {
    const img = document.createElement('img');
    img.className = 'app-icon';
    img.loading = 'lazy';
    img.alt = app.name || '';
    img.src = `/api/appicon?path=${encodeURIComponent(app.path)}`;
    img.addEventListener('error', () => {
      img.remove();
      const fallback = el('span', 'app-glyph', appGlyph(app.name));
      iconWrap.append(fallback);
    });
    iconWrap.append(img);
  } else {
    iconWrap.append(el('span', 'app-glyph', appGlyph(app.name)));
  }
  chip.append(iconWrap);
  chip.append(el('span', 'app-name', app.name || basename(app.path)));

  chip.addEventListener('click', () => openWithApp(app));
  return chip;
}

function appGlyph(name) {
  const c = (name && name.trim()) ? name.trim()[0].toUpperCase() : '▢';
  return c;
}

async function openWithApp(app) {
  const paths = [...state.selection];
  try {
    await api.openWith(app.path, paths);
    if (paths.length) toast(`↗ opened ${plural(paths.length, 'item')} in ${app.name}`);
    else toast(`launched ${app.name}`);
  } catch (err) {
    toast(errMsg(err));
  }
}

async function onRevealClick() {
  const paths = [...state.selection];
  if (!paths.length) return;
  try {
    await api.reveal(paths);
  } catch (err) {
    toast(errMsg(err));
  }
}

// ---------------------------------------------------------------- read-only effectors

async function runReport(name) {
  const paths = targetPaths();
  if (!paths.length) { toast('substrate not loaded yet'); return; }
  const scope = state.selection.size ? `${state.selection.size} selected` : 'whole substrate';
  setBusy(name, true);
  try {
    const body = name === 'stale' ? { paths, days: STALE_DAYS } : { paths };
    const res = await api.runEffector(name, body);
    const render = {
      summarize: renderSummary,
      classify: renderClassify,
      duplicates: renderDuplicates,
      stale: renderStale,
    }[name](res);
    bus.emit('window:open', { title: `${REPORT_TITLES[name]} · ${scope}`, kind: name, render, w: 600, h: 470 });
  } catch (err) {
    toast(errMsg(err));
  } finally {
    setBusy(name, false);
  }
}

function renderSummary(res) {
  const report = res.report || {};
  return (content) => {
    const wrap = el('div', 'fxr');

    const grid = el('div', 'fxr-grid');
    const stats = [
      [String(report.items ?? 0), 'items'],
      [fmtBytes(report.bytes), 'total size'],
      [String(report.files ?? 0), 'files'],
      [String(report.dirs ?? 0), 'directories'],
    ];
    for (const [num, lbl] of stats) {
      const cell = el('div', 'fxr-stat');
      cell.append(el('div', 'fxr-num', num), el('div', 'fxr-lbl', lbl));
      grid.append(cell);
    }
    wrap.append(grid);

    const types = Array.isArray(report.types) ? report.types.slice(0, 5) : [];
    if (types.length) {
      wrap.append(el('div', 'fxr-sec', 'top types'));
      const max = Math.max(...types.map(t => t.bytes || 0), 1);
      for (const t of types) {
        const row = el('div', 'fxr-row');
        const ext = t.ext ? (t.ext.startsWith('.') ? t.ext : `.${t.ext}`) : 'no ext';
        row.append(el('span', 'fxr-ext', ext));
        const bar = el('span', 'fxr-bar');
        const fill = el('i', 'fxr-fill');
        fill.style.width = `${Math.max(2, ((t.bytes || 0) / max) * 100)}%`;
        bar.append(fill);
        row.append(bar, el('span', 'fxr-meta', `${t.count} · ${fmtBytes(t.bytes)}`));
        wrap.append(row);
      }
    }

    const marks = [
      ['newest', report.newest, m => dateFmt(m.mtime)],
      ['oldest', report.oldest, m => dateFmt(m.mtime)],
      ['largest', report.largest, m => fmtBytes(m.size)],
    ].filter(([, m]) => m && m.path);
    if (marks.length) {
      wrap.append(el('div', 'fxr-sec', 'landmarks'));
      for (const [lbl, item, fmt] of marks) {
        const row = el('div', 'fxr-row');
        const name = el('span', 'fxr-name fxr-grow', basename(item.path));
        name.title = item.path;
        row.append(el('span', 'fxr-tag', lbl), name, el('span', 'fxr-meta', fmt(item)));
        wrap.append(row);
      }
    }
    content.append(wrap);
  };
}

function renderClassify(res) {
  const groups = res.groups || [];
  return (content) => {
    const wrap = el('div', 'fxr');
    if (!groups.length) {
      wrap.append(el('div', 'fxr-empty', 'nothing to classify'));
      content.append(wrap);
      return;
    }
    const max = Math.max(...groups.map(g => g.bytes || 0), 1);
    for (const g of groups) {
      const row = el('div', 'fxr-row clickable');
      row.append(el('span', 'fxr-tag', g.label));
      const bar = el('span', 'fxr-bar');
      const fill = el('i', 'fxr-fill');
      fill.style.width = `${Math.max(2, ((g.bytes || 0) / max) * 100)}%`;
      bar.append(fill);
      row.append(bar, el('span', 'fxr-meta', `${g.count} · ${fmtBytes(g.bytes)}`));
      row.addEventListener('click', () => {
        setSelection(g.paths || []);
        toast(`selected ${plural(g.count, 'item')} · ${g.label}`);
      });
      wrap.append(row);
    }
    content.append(wrap);
  };
}

function renderDuplicates(res) {
  const groups = res.groups || [];
  return (content) => {
    const wrap = el('div', 'fxr');
    if (!groups.length) {
      wrap.append(el('div', 'fxr-empty', 'no duplicates found — the substrate is lean'));
      content.append(wrap);
      return;
    }
    for (const g of groups) {
      const grp = el('div', 'fxr-group');
      const head = el('div', 'fxr-row');
      head.append(
        el('span', 'fxr-hash', (g.hash || '').slice(0, 8)),
        el('span', 'fxr-meta', `${g.count}× ${fmtBytes(g.size)} · ${fmtBytes((g.count - 1) * (g.size || 0))} wasted`),
      );
      const btn = el('button', 'btn-ghost fxr-mini', 'select duplicates');
      btn.type = 'button';
      btn.addEventListener('click', () => {
        const dups = (g.paths || []).slice(1);
        const next = new Set(state.selection);
        for (const p of dups) next.add(p);
        setSelection([...next]);
        toast(`selected ${plural(dups.length, 'duplicate')}`);
      });
      head.append(btn);
      grp.append(head);
      (g.paths || []).forEach((p, i) => {
        const line = el('div', i === 0 ? 'fxr-path fxr-first' : 'fxr-path', relPath(p));
        line.title = i === 0 ? `${p} (kept)` : p;
        grp.append(line);
      });
      wrap.append(grp);
    }
    content.append(wrap);
  };
}

function renderStale(res) {
  const items = res.items || [];
  return (content) => {
    const wrap = el('div', 'fxr');
    if (!items.length) {
      wrap.append(el('div', 'fxr-empty', `nothing untouched for ${STALE_DAYS}+ days`));
      content.append(wrap);
      return;
    }
    const head = el('div', 'fxr-row');
    head.append(el('span', 'fxr-sec fxr-grow', `${plural(items.length, 'item')} · older than ${STALE_DAYS} days`));
    const all = el('button', 'btn-ghost fxr-mini', 'select all');
    all.type = 'button';
    all.addEventListener('click', () => {
      setSelection(items.map(i => i.path));
      toast(`selected ${plural(items.length, 'stale item')}`);
    });
    head.append(all);
    wrap.append(head);

    const list = el('div', 'fxr-list');
    for (const it of items) {
      const row = el('div', 'fxr-row fxr-tight');
      const p = el('span', 'fxr-path fxr-grow', relPath(it.path));
      p.title = it.path;
      row.append(p, el('span', 'fxr-age', `${ageDays(it.mtime)}d`), el('span', 'fxr-meta', fmtBytes(it.size)));
      list.append(row);
    }
    wrap.append(list);
    content.append(wrap);
  };
}

// ---------------------------------------------------------------- rename → proposal

async function runRename() {
  const paths = [...state.selection];
  if (!paths.length) return;
  setBusy('rename', true);
  try {
    const res = await api.runEffector('rename', { paths });
    const proposal = res.proposal;
    if (!proposal) throw new Error('no proposal returned');
    state.proposals.push(proposal);
    updateBadge();
    bus.emit('proposal:created', { proposal });
    openProposalWindow(proposal);
  } catch (err) {
    toast(errMsg(err));
  } finally {
    setBusy('rename', false);
  }
}

function openProposalWindow(proposal) {
  bus.emit('window:open', {
    title: 'Rename · proposal',
    kind: 'proposal',
    w: 620,
    h: 440,
    render: (content) => {
      const wrap = el('div', 'fxr');
      const actions = proposal.actions || [];
      if (!actions.length) {
        wrap.append(el('div', 'fxr-empty', 'no rename actions — names are already clean'));
      } else {
        wrap.append(el('div', 'fxr-sec', `${plural(actions.length, 'rename')} proposed — nothing written until merge`));
        const list = el('div', 'fxr-list');
        for (const a of actions) {
          const row = el('div', 'fxr-row fxr-tight');
          const from = el('span', 'fxr-path fxr-grow', relPath(a.from));
          from.title = a.from;
          const to = el('span', 'fxr-path fxr-to fxr-grow', relPath(a.to));
          to.title = a.to;
          row.append(from, el('span', 'fxr-arrow', '→'), to);
          list.append(row);
        }
        wrap.append(list);
      }

      const footer = el('div', 'fxr-footer');
      const status = el('span', 'fxr-status', '');
      const discard = el('button', 'btn-ghost', 'Discard');
      discard.type = 'button';
      const merge = el('button', 'btn-primary', 'Merge');
      merge.type = 'button';
      footer.append(status, discard, merge);
      wrap.append(footer);

      const settle = (txt) => {
        discard.disabled = merge.disabled = true;
        status.textContent = txt;
        wrap.classList.add('resolved');
      };
      discard.addEventListener('click', () => resolveProposal(proposal, 'discard', settle, [discard, merge]));
      merge.addEventListener('click', () => resolveProposal(proposal, 'merge', settle, [discard, merge]));
      content.append(wrap);
    },
  });
}

async function resolveProposal(proposal, action, settle, buttons) {
  buttons.forEach(b => { b.disabled = true; });
  try {
    if (action === 'merge') {
      const res = await api.mergeProposal(proposal.id);
      const n = (res.applied || []).length;
      const errs = (res.errors || []).length;
      toast(errs ? `merged ${n} · ${errs} skipped` : `✓ merged ${plural(n, 'rename')}`);
    } else {
      await api.discardProposal(proposal.id);
      toast('proposal discarded');
    }
    state.proposals = state.proposals.filter(p => p.id !== proposal.id);
    updateBadge();
    bus.emit('proposal:resolved', { id: proposal.id, action });
    settle(action === 'merge' ? 'merged' : 'discarded');
    try {
      const tree = await api.getTree();
      state.tree = tree;
      bus.emit('tree:updated', { tree });
    } catch { /* tree refresh best-effort */ }
  } catch (err) {
    toast(errMsg(err));
    buttons.forEach(b => { b.disabled = false; });
  }
}

async function openProposalsWindow() {
  await refreshProposals();
  const proposals = [...state.proposals];
  bus.emit('window:open', {
    title: 'Proposals',
    kind: 'proposals',
    w: 520,
    h: 380,
    render: (content) => {
      const wrap = el('div', 'fxr');
      if (!proposals.length) {
        wrap.append(el('div', 'fxr-empty', 'no open proposals — nothing pending against the substrate'));
        content.append(wrap);
        return;
      }
      for (const p of proposals) {
        const row = el('div', 'fxr-row clickable');
        row.append(el('span', 'fxr-tag', p.kind || 'proposal'));
        const name = el('span', 'fxr-name fxr-grow', plural((p.actions || []).length, 'action'));
        row.append(name, el('span', 'fxr-meta', dateFmt(p.created)));
        row.addEventListener('click', () => openProposalWindow(p));
        wrap.append(row);
      }
      content.append(wrap);
    },
  });
}

// ---------------------------------------------------------------- checkpoint

async function runCheckpoint() {
  const paths = [...state.selection];
  if (!paths.length) return;
  setBusy('checkpoint', true);
  try {
    await api.checkpoint(paths);
    toast('◆ checkpoint created');
    api.getMeta(paths).catch(() => {});
  } catch (err) {
    toast(errMsg(err));
  } finally {
    setBusy('checkpoint', false);
  }
}

function openCheckpointsWindow() {
  bus.emit('window:open', {
    title: 'Checkpoints',
    kind: 'checkpoints',
    w: 540,
    h: 400,
    render: (content) => {
      const wrap = el('div', 'fxr');
      const loading = el('div', 'fxr-empty', 'reading checkpoints…');
      wrap.append(loading);
      content.append(wrap);
      api.getCheckpoints().then(res => {
        loading.remove();
        const cps = (res.checkpoints || []).slice().reverse();
        if (!cps.length) {
          wrap.append(el('div', 'fxr-empty', 'no checkpoints yet — ◆ preserves a copy inside the substrate'));
          return;
        }
        for (const c of cps) {
          const row = el('div', 'fxr-row');
          row.append(el('span', 'fxr-diamond', '◆'));
          const name = el('span', 'fxr-name fxr-grow', c.label || c.id);
          row.append(name, el('span', 'fxr-meta', `${plural(c.count ?? 0, 'item')} · ${fmtBytes(c.bytes)} · ${dateFmt(c.created)}`));
          wrap.append(row);
        }
      }).catch(err => {
        loading.textContent = errMsg(err);
      });
    },
  });
}

// ---------------------------------------------------------------- release

function onReleaseClick() {
  if (!canRun('release')) return;
  if (releaseArmed) {
    disarmRelease();
    runRelease();
    return;
  }
  releaseArmed = true;
  btns.release.classList.add('confirm');
  releaseLabelEl.textContent = 'sure?';
  releaseTimer = setTimeout(disarmRelease, 2500);
}

function disarmRelease() {
  releaseArmed = false;
  if (releaseTimer) { clearTimeout(releaseTimer); releaseTimer = null; }
  btns.release?.classList.remove('confirm');
  if (releaseLabelEl) releaseLabelEl.textContent = 'Release';
}

async function runRelease() {
  const paths = [...state.selection];
  if (!paths.length) return;
  setBusy('release', true);
  try {
    await api.runEffector('release', { paths });
    bus.emit('release:start', { paths });
    setLayer('filespace');
    toast(`↥ ${plural(paths.length, 'item')} released through the membrane`);
    api.getMeta(paths).catch(() => {});
  } catch (err) {
    toast(errMsg(err));
  } finally {
    setBusy('release', false);
  }
}

// ---------------------------------------------------------------- styles
// Panel structure classes from the contract (.fx-btn, .fx-badge, .btn-*) are styled
// by main.css; everything below covers only this module's own report/header classes.

function injectStyles() {
  if (document.getElementById('fx-styles')) return;
  const style = document.createElement('style');
  style.id = 'fx-styles';
  style.textContent = `
#effector-panel .fx-header { padding: 18px 16px 14px; border-bottom: 1px solid var(--line); }
#effector-panel .fx-wordmark { font: 600 11px/1 var(--font); letter-spacing: .42em; color: var(--ink-dim); }
#effector-panel .fx-root { margin-top: 12px; font: 500 13px/1.2 var(--font); color: var(--ink); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
#effector-panel .fx-selection { margin-top: 5px; font: 400 10px/1.4 var(--mono); color: var(--accent); min-height: 14px; transition: color .2s ease; }
#effector-panel .fx-selection.empty { color: var(--ink-dim); }
#effector-panel .fx-tools { display: flex; flex-direction: column; gap: 2px; padding: 10px 8px; }
#effector-panel .fx-divider { height: 1px; margin: 2px 14px; background: var(--line); }
#effector-panel .fx-btn .fx-glyph { display: inline-block; width: 20px; text-align: center; flex: none; color: var(--ink-dim); }
#effector-panel .fx-btn.confirm .fx-label, #effector-panel .fx-btn.confirm .fx-glyph { color: var(--gold); }
.fxr { display: flex; flex-direction: column; gap: 12px; min-height: 100%; font: 400 12px/1.45 var(--font); color: var(--ink); }
.fxr-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
.fxr-stat { border: 1px solid var(--line); border-radius: 8px; padding: 12px 14px; background: rgba(255,255,255,.02); }
.fxr-num { font: 600 22px/1.1 var(--font); color: var(--ink); font-variant-numeric: tabular-nums; }
.fxr-lbl { margin-top: 4px; font: 500 9px/1 var(--font); letter-spacing: .18em; text-transform: uppercase; color: var(--ink-dim); }
.fxr-sec { font: 500 9px/1.4 var(--font); letter-spacing: .18em; text-transform: uppercase; color: var(--ink-dim); margin: 2px 0 -4px; }
.fxr-row { display: flex; align-items: center; gap: 10px; padding: 7px 10px; border: 1px solid transparent; border-radius: 8px; min-width: 0; }
.fxr-row.fxr-tight { padding: 4px 10px; }
.fxr-row.clickable { cursor: pointer; transition: background .15s ease, border-color .15s ease; }
.fxr-row.clickable:hover { background: rgba(76,201,240,.07); border-color: var(--line); }
.fxr-row.clickable:active { background: rgba(76,201,240,.12); }
.fxr-tag { font: 500 11px var(--font); color: var(--ink); min-width: 64px; text-transform: capitalize; flex: none; }
.fxr-ext { font: 11px var(--mono); color: var(--ink); min-width: 56px; flex: none; }
.fxr-bar { position: relative; flex: 1; height: 4px; border-radius: 2px; background: rgba(255,255,255,.06); overflow: hidden; min-width: 40px; }
.fxr-fill { position: absolute; top: 0; left: 0; bottom: 0; border-radius: 2px; background: var(--accent); opacity: .6; }
.fxr-meta { margin-left: auto; font: 10px var(--mono); color: var(--ink-dim); white-space: nowrap; flex: none; }
.fxr-name { font: 12px var(--font); color: var(--ink); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.fxr-path { font: 11px var(--mono); color: var(--ink-dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
.fxr-path.fxr-first { color: var(--ink); }
.fxr-path.fxr-to { color: var(--ink); }
.fxr-grow { flex: 1; }
.fxr-group { border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 4px; background: rgba(255,255,255,.015); }
.fxr-group .fxr-row { padding: 0 0 6px; border: none; }
.fxr-hash { font: 11px var(--mono); color: var(--accent); letter-spacing: .04em; flex: none; }
.fxr-diamond { color: var(--ink-dim); font-size: 11px; flex: none; }
.fxr-mini { font-size: 10px; padding: 3px 10px; flex: none; }
.fxr-empty { padding: 32px 12px; text-align: center; font: 12px/1.6 var(--font); color: var(--ink-dim); }
.fxr-list { display: flex; flex-direction: column; gap: 2px; min-height: 0; overflow-y: auto; }
.fxr-arrow { color: var(--gold); flex: none; font: 12px var(--mono); }
.fxr-age { font: 10px var(--mono); color: var(--ink-dim); flex: none; min-width: 40px; text-align: right; }
.fxr-footer { display: flex; align-items: center; gap: 8px; justify-content: flex-end; margin-top: auto; padding-top: 12px; border-top: 1px solid var(--line); }
.fxr-status { margin-right: auto; font: 10px var(--mono); color: var(--ink-dim); letter-spacing: .08em; text-transform: uppercase; }
.fxr.resolved .fxr-list { opacity: .45; }
`;
  document.head.appendChild(style);
}
