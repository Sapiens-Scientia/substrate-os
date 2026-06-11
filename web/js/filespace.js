// Substrate OS — Filespace renderer (Builder D, contract §9 + addendum §16.1)
// A genuine node-link TREE carved into the marble: a trunk descending from the
// membrane, branches forking down/right (tapered ∝ subtree bytes), discs for
// directory branch-nodes and smaller discs for file leaves, state rings around
// nodes. Hard walls, permeable membrane, disk gauge, pan/zoom, selection, live
// pulses, breathing, and the release ascent are all preserved from §9.

import { bus } from './bus.js';
import { state, setSelection, toggleSelection, clearSelection, nodeByPath } from './state.js';
import * as api from './api.js';

export const MEMBRANE_H = 26;

const MAX_DEPTH = 9;
const PULSE_MS = 4000;

// node radii (world px)
const DIR_R_MIN = 5, DIR_R_MAX = 16;
const FILE_R_MIN = 3, FILE_R_MAX = 10;
const ROOT_R = 17;
const MORE_R = 4;

// link taper (world px)
const LINK_MIN = 2, LINK_MAX = 14;

// labels appear when on-screen radius ≥ this OR camera z ≥ LABEL_Z
const LABEL_SCREEN_R = 7;
const LABEL_Z = 1.3;
// gap (world px) between a node's right edge and the start of its label
const LABEL_GAP = 5;
// don't bother drawing a right-side label thinner than this (on-screen px) — a
// 1–2 char stub is just noise; suppress unless the node is hovered/selected.
const LABEL_MIN_SCREEN_W = 26;
// hard cap on label width (on-screen px) so long names stay legible & calm.
const LABEL_MAX_SCREEN_W = 180;

// ---------------------------------------------------------------------------
// deterministic pseudo-random / hashing (no Math.random per frame, ever)

function srand(seed) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function hashStr(s) {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h >>> 0;
}

// ---------------------------------------------------------------------------
// color helpers

function parseHex(c) {
  c = (c || '').trim();
  if (c[0] === '#') {
    if (c.length === 4) return [parseInt(c[1] + c[1], 16), parseInt(c[2] + c[2], 16), parseInt(c[3] + c[3], 16)];
    if (c.length >= 7) return [parseInt(c.slice(1, 3), 16), parseInt(c.slice(3, 5), 16), parseInt(c.slice(5, 7), 16)];
  }
  return null;
}

function rgba(c, a) {
  const p = parseHex(c);
  if (!p) return c;
  return `rgba(${p[0]},${p[1]},${p[2]},${a})`;
}

function mix(a, b, t) {
  const pa = parseHex(a), pb = parseHex(b);
  if (!pa || !pb) return a;
  const m = pa.map((v, i) => Math.round(v + (pb[i] - v) * t));
  return `rgb(${m[0]},${m[1]},${m[2]})`;
}

function brighten(c, t) { return mix(c, '#ffffff', t); }
function darken(c, t) { return mix(c, '#000000', t); }

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

// ---------------------------------------------------------------------------
// formatting

function fmtBytes(n) {
  if (!Number.isFinite(n) || n < 0) n = 0;
  const u = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0, v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return (i === 0 ? String(Math.round(v)) : v < 10 ? v.toFixed(1) : String(Math.round(v))) + ' ' + u[i];
}

function fmtDate(ms) {
  if (!ms) return '—';
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch { return '—'; }
}

function dirnameOf(p) {
  const i = p.lastIndexOf('/');
  return i > 0 ? p.slice(0, i) : p;
}

// node geometry from bytes (used by both layout and draw)
function dirRadius(bytes) {
  const lg = Math.log2(Math.max(bytes, 1) + 1);
  return clamp(DIR_R_MIN + lg * 0.42, DIR_R_MIN, DIR_R_MAX);
}
function fileRadius(bytes) {
  const lg = Math.log2(Math.max(bytes, 1) + 1);
  return clamp(FILE_R_MIN + lg * 0.36, FILE_R_MIN, FILE_R_MAX);
}
function linkWidth(bytes, refBytes) {
  // width ∝ subtree bytes, on a log scale so a single huge file doesn't dwarf
  // everything; normalized against the largest mass in THIS tree (the root
  // subtree's bytes) so on-screen branches actually span the full 2..14 range
  // and large vs small subtrees read distinctly. (Normalizing against disk
  // total flattened everything — no subtree ever approaches a 494GB volume.)
  const ref = Math.max(refBytes || 0, 1);
  const lg = Math.log2(Math.max(bytes, 1) + 1);
  const lgRef = Math.log2(ref + 1);
  const t = clamp(lg / lgRef, 0, 1);
  return clamp(LINK_MIN + t * (LINK_MAX - LINK_MIN), LINK_MIN, LINK_MAX);
}

// ---------------------------------------------------------------------------
// layoutTree — PURE. tree: TreeNode; viewport: {width, height, diskTotal}.
// Returns { membrane, block, carve, nodes, links, hints, nodeByPath, bounds }.
// Mass-weighted tidy tree: each node owns a horizontal band ∝
// max(leafCount, sqrt(bytes)); parent centered over its children; minimum
// sibling gap ≥ node diameter + 6px; y by depth.

export function layoutTree(tree, viewport) {
  const W = Math.max(1, viewport.width || 1);
  const H = Math.max(1, viewport.height || 1);
  const membrane = { x: 0, y: 0, w: W, h: MEMBRANE_H };
  const block = { x: 0, y: MEMBRANE_H, w: W, h: H - MEMBRANE_H };
  const out = {
    membrane, block, carve: null,
    nodes: [], links: [], hints: [],
    nodeByPath: new Map(),
    bounds: { minX: 0, maxX: W, minY: MEMBRANE_H, maxY: H },
  };
  if (!tree) return out;

  const diskTotal = viewport.diskTotal > 0 ? viewport.diskTotal : Math.max((tree.size || 1) * 2, 1);
  // reference mass for branch thickness = the largest subtree in THIS tree
  // (the root). Branch widths span the full LINK_MIN..LINK_MAX range against it.
  const massRef = Math.max(tree.size || 0, 1);

  // carved cavity (kept for the luminous shaft + honest fraction cue): the tree
  // root sits at its top-center, just below the membrane.
  const frac = clamp((tree.size || 0) / diskTotal, 0.28, 0.86);
  const carveX = block.x + 40;
  const carveW = Math.max(60, Math.min(frac * block.w, block.w - carveX - 48));
  out.carve = { x: carveX, w: carveW };

  // level (depth) spacing — upper levels breathe, deep levels tighten.
  const levelGap = d => Math.max(64, 132 - d * 8);

  // y per depth, precomputed cumulatively.
  const rootY = block.y + 30; // a little below the membrane
  const depthY = [rootY];
  for (let d = 1; d <= MAX_DEPTH + 1; d++) depthY[d] = depthY[d - 1] + levelGap(d - 1);

  const radiusOf = node => {
    if (node.kind === 'more') return MORE_R;
    if (node.kind === 'dir') return dirRadius(node.size || 0);
    return fileRadius(node.size || 0);
  };

  // First pass: build a layout-node tree, compute weight + the band width each
  // node needs (max of its own footprint and the sum of its children's bands).
  let nextId = 0;
  const mkNode = (node, depth, kind) => {
    const path = node.path || '';
    const hsh = path ? hashStr(path) : hashStr((node.name || '?') + ':' + (nextId));
    const ln = {
      id: nextId++, node, path, depth, kind,
      r: radiusOf(node),
      x: 0, y: depthY[depth] || rootY,
      parent: null, kids: [],
      width: 0, weight: 0,
      phase: (hsh % 1024) / 1024 * Math.PI * 2,
      jit: 0.8 + ((hsh >>> 10) % 512) / 512 * 0.4,
    };
    return ln;
  };

  const root = mkNode(tree, 0, tree.kind || 'dir');
  root.r = ROOT_R;

  // build children recursively (depth-capped), merging 'more' nodes.
  const build = (node, ln) => {
    if (ln.depth >= MAX_DEPTH) {
      if (node.children && node.children.length) {
        ln.hasDeeper = true;
      }
      return;
    }
    const kids = node.children;
    if (!kids || !kids.length) return;

    let moreBytes = 0, moreCount = 0, moreName = null, moreHas = false;
    const kept = [];
    for (const c of kids) {
      if (c.kind === 'more') {
        moreHas = true;
        moreBytes += Math.max(c.size || 0, 0);
        const m = /\d+/.exec(c.name || '');
        moreCount += m ? parseInt(m[0], 10) : 0;
        moreName = c.name || moreName;
      } else {
        kept.push(c);
      }
    }
    kept.sort((a, b) => (b.size || 0) - (a.size || 0));

    for (const c of kept) {
      const cln = mkNode(c, ln.depth + 1, c.kind || 'file');
      cln.parent = ln;
      ln.kids.push(cln);
      build(c, cln);
    }
    if (moreHas || moreBytes > 0 || moreCount > 0) {
      const synth = {
        name: moreName || `… ${moreCount} more`,
        path: (node.path || '') + '/…more',
        kind: 'more', size: moreBytes, mtime: 0, states: [], count: moreCount,
      };
      const cln = mkNode(synth, ln.depth + 1, 'more');
      cln.parent = ln;
      ln.kids.push(cln);
    }
  };
  build(tree, root);

  // leaf count + weight (bottom-up).
  const measure = (ln) => {
    if (!ln.kids.length) {
      ln.leafCount = 1;
    } else {
      let lc = 0;
      for (const k of ln.kids) lc += measure(k);
      ln.leafCount = lc;
    }
    ln.weight = Math.max(ln.leafCount, Math.sqrt(Math.max(ln.node.size || 0, 0)) / 64 + 1);
    return ln.leafCount;
  };
  measure(root);

  // band width each subtree needs. A node needs at least its own diameter +
  // padding; an internal node needs at least the sum of its children's bands
  // plus the minimum sibling gaps.
  const SIB_PAD = 6;
  const minBand = (ln) => (ln.r * 2 + SIB_PAD * 2);
  const computeWidth = (ln) => {
    if (!ln.kids.length) { ln.width = minBand(ln); return ln.width; }
    let sum = 0;
    for (let i = 0; i < ln.kids.length; i++) {
      const k = ln.kids[i];
      computeWidth(k);
      sum += k.width;
      if (i > 0) {
        // ensure ≥ node diameter + 6px between adjacent sibling centers' bands
        const gapNeed = (ln.kids[i - 1].r + k.r) + SIB_PAD;
        const have = (ln.kids[i - 1].width + k.width) / 2;
        if (have < gapNeed) sum += (gapNeed - have);
      }
    }
    ln.width = Math.max(minBand(ln), sum);
    return ln.width;
  };
  computeWidth(root);

  // assign x: lay children left→right within the parent's band, then center the
  // parent over the span of its children.
  const assignX = (ln, left) => {
    if (!ln.kids.length) {
      ln.x = left + ln.width / 2;
      return;
    }
    let cx = left;
    for (const k of ln.kids) {
      assignX(k, cx);
      cx += k.width;
    }
    const first = ln.kids[0], last = ln.kids[ln.kids.length - 1];
    ln.x = (first.x + last.x) / 2;
  };
  // anchor the whole tree so the root lands at the carved shaft's center.
  assignX(root, 0);
  const shaftCenter = carveX + carveW / 2;
  const shift = shaftCenter - root.x;

  // flatten + apply shift; record bounds + links + nodeByPath.
  const b = out.bounds;
  b.minX = Infinity; b.maxX = -Infinity;
  b.minY = block.y; b.maxY = block.y;
  const visit = (ln) => {
    ln.x += shift;
    out.nodes.push(ln);
    if (ln.path && ln.kind !== 'more') out.nodeByPath.set(ln.path, ln);
    b.minX = Math.min(b.minX, ln.x - ln.r);
    b.maxX = Math.max(b.maxX, ln.x + ln.r);
    b.maxY = Math.max(b.maxY, ln.y + ln.r);
    if (ln.parent) {
      out.links.push({
        parent: ln.parent, child: ln,
        w: linkWidth(ln.node.size || 0, massRef),
      });
    }
    if (ln.hasDeeper) {
      out.hints.push({ x: ln.x, y: ln.y + ln.r, len: Math.max(28, levelGap(ln.depth) * 0.6) });
      b.maxY = Math.max(b.maxY, ln.y + ln.r + Math.max(28, levelGap(ln.depth) * 0.6));
    }
    for (const k of ln.kids) visit(k);
  };
  visit(root);
  if (!Number.isFinite(b.minX)) { b.minX = 0; b.maxX = W; }

  // per-node horizontal room for a right-side label: distance (world px) from
  // where the label starts (x + r + LABEL_GAP) to the left edge of the nearest
  // same-depth node to its right. Labels are clamped to this so a node never
  // overruns its neighbour; nodes with too little room suppress their label
  // (except when hovered/selected — drawn on top last). Eliminates label spam.
  {
    const byDepth = new Map();
    for (const n of out.nodes) {
      let row = byDepth.get(n.depth);
      if (!row) { row = []; byDepth.set(n.depth, row); }
      row.push(n);
    }
    for (const row of byDepth.values()) {
      row.sort((a, c) => a.x - c.x);
      for (let i = 0; i < row.length; i++) {
        const n = row[i];
        let room = Infinity;
        for (let j = i + 1; j < row.length; j++) {
          const m = row[j];
          if (m.x + m.r <= n.x) continue; // fully left, ignore
          room = (m.x - m.r) - (n.x + n.r + LABEL_GAP);
          break;
        }
        n.labelRoom = room; // Infinity = open to the right
      }
    }
  }

  // include the trunk descending from the membrane to the root.
  b.minY = block.y;

  return out;
}

// ---------------------------------------------------------------------------
// renderer

export function initFilespace(container) {
  const canvas = (container && container.querySelector('#filespace-canvas'))
    || document.getElementById('filespace-canvas');
  if (!canvas || canvas.dataset.fsInit) return;
  canvas.dataset.fsInit = '1';
  const ctx = canvas.getContext('2d');
  const tooltip = document.getElementById('tooltip');
  const host = container || canvas.parentElement;

  const cs = getComputedStyle(document.documentElement);
  const cv = (n, fb) => ((cs.getPropertyValue(n) || '').trim() || fb);
  const theme = {
    bg: cv('--bg', '#07090f'),
    marble: cv('--marble', '#131a26'),
    vein: cv('--marble-vein', '#1b2433'),
    carve: cv('--carve', '#0c1018'),
    chamber: cv('--chamber', '#223046'),
    chamberHot: cv('--chamber-hot', '#2d4159'),
    line: cv('--line', '#2c3a52'),
    ink: cv('--ink', '#c8d4e8'),
    inkDim: cv('--ink-dim', '#6b7a94'),
    accent: cv('--accent', '#4cc9f0'),
    gold: cv('--gold', '#f0b35e'),
    green: cv('--green', '#69c98f'),
    violet: cv('--violet', '#a78bfa'),
    down: cv('--down', '#5e9bf0'),
    hot: cv('--hot', '#ff6b6b'),
    font: cv('--font', 'ui-sans-serif, -apple-system, "SF Pro", system-ui, sans-serif'),
    mono: cv('--mono', 'ui-monospace, "SF Mono", Menlo, monospace'),
  };
  const dirFill = mix(theme.chamber, theme.carve, 0.22);
  const fileFill = theme.chamber;
  const wallFill = brighten(theme.line, 0.38);
  const branchDim = mix(theme.vein, theme.carve, 0.4);

  const STRATA = Array.from({ length: 14 }, (_, i) => ({
    f: (i + 0.6) / 14.6,
    amp: 1 + srand(i * 3 + 1) * 2.4,
    freq: 0.006 + srand(i * 3 + 2) * 0.012,
    phase: srand(i * 3 + 3) * Math.PI * 2,
    alpha: 0.3 + srand(i * 7 + 5) * 0.45,
  }));

  // --- mutable view state -------------------------------------------------
  let dpr = window.devicePixelRatio || 1;
  let cssW = 0, cssH = 0;
  let world = null;                       // {w, h} fixed world units (initial viewport)
  const cam = { x: 0, y: 0, z: 1 };
  let userMoved = false;
  let layout = layoutTree(null, { width: 1, height: 1 });
  let dirty = true;
  let lastDraw = 0;
  let metaFetched = false;

  const pulses = new Map();               // path -> t0
  const particles = [];                   // release ascent
  const ripples = [];                     // membrane crossings {x, t0}
  let hoverNode = null;
  let hoverSubtree = null;                // Set of node ids under hovered node (branch highlight)
  let drag = null;                        // {mode:'pan'|'maybe'|'lasso', ...}
  const inflight = new Set();             // subtree refetch guard

  const markDirty = () => { dirty = true; };

  // --- sizing ---------------------------------------------------------------
  function resize() {
    const r = host.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) return;
    dpr = window.devicePixelRatio || 1;
    cssW = r.width; cssH = r.height;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    canvas.style.width = cssW + 'px';
    canvas.style.height = cssH + 'px';
    if (!world || !userMoved) {
      world = { w: cssW, h: cssH };
      relayout();
    }
    markDirty();
  }

  function relayout() {
    if (!world) return;
    layout = layoutTree(state.tree, {
      width: world.w, height: world.h,
      diskTotal: state.disk ? state.disk.total : 0,
    });
    hoverNode = null;
    hoverSubtree = null;
    markDirty();
  }

  // --- coordinate transforms --------------------------------------------------
  const toWorld = (sx, sy) => ({ x: sx / cam.z + cam.x, y: sy / cam.z + cam.y });

  function hitTest(wp) {
    const n = layout.nodes;
    // topmost-first; pad small nodes so they remain clickable.
    let best = null, bestD = Infinity;
    for (let i = n.length - 1; i >= 0; i--) {
      const o = n[i];
      const pad = Math.max(o.r, 5);
      const dx = wp.x - o.x, dy = wp.y - o.y;
      const d2 = dx * dx + dy * dy;
      if (d2 <= (pad + 2) * (pad + 2) && d2 < bestD) { best = o; bestD = d2; }
    }
    return best;
  }

  function nodeForPathOrAncestor(p) {
    if (!p) return null;
    let cur = p;
    const rootPath = state.tree ? state.tree.path : null;
    for (let i = 0; i < 64; i++) {
      const o = layout.nodeByPath.get(cur);
      if (o) return o;
      if (!rootPath || cur === rootPath || cur.indexOf('/') <= 0) return null;
      cur = dirnameOf(cur);
      if (cur.length < (rootPath ? rootPath.length : 1)) return null;
    }
    return null;
  }

  function subtreeIds(ln) {
    const set = new Set();
    const walk = (n) => { set.add(n.id); for (const k of n.kids) walk(k); };
    if (ln) walk(ln);
    return set;
  }

  // --- states ---------------------------------------------------------------
  function effStates(ln) {
    const a = (ln.node && ln.node.states) || [];
    const b = (state.metas instanceof Map && state.metas.get(ln.path)) || [];
    if (!b.length) return a;
    const u = new Set(a);
    for (const s of b) u.add(s);
    return [...u];
  }

  // is this node (path-based) inside the current selection?
  function isSelected(ln) {
    if (!state.selection || !ln.path) return false;
    if (state.selection.has(ln.path)) return true;
    for (const p of state.selection) {
      if (ln.path === p || ln.path.startsWith(p + '/')) return true;
    }
    return false;
  }

  // --- meta batch fetch -------------------------------------------------------
  function fetchMeta() {
    if (!state.tree) return;
    const cands = layout.nodes
      .filter(n => n.kind !== 'more' && n.path)
      .sort((a, b) => (b.node.size || 0) - (a.node.size || 0))
      .slice(0, 150)
      .map(n => n.path);
    if (!cands.length) return;
    Promise.resolve(api.getMeta(cands)).then(res => {
      const metas = res && res.metas ? res.metas : res;
      if (metas && typeof metas === 'object' && state.metas instanceof Map) {
        for (const [p, st] of Object.entries(metas)) state.metas.set(p, st);
        markDirty();
      }
    }).catch(e => console.error('filespace meta fetch', e));
  }

  // --- tree patching (subtree:updated) ---------------------------------------
  function patchSubtree(path, node) {
    if (!node) return;
    if (!state.tree || path === state.tree.path) {
      if (state.tree) Object.assign(state.tree, node);
      relayout();
      return;
    }
    const pp = dirnameOf(path);
    const parent = pp === state.tree.path ? state.tree : nodeByPath(pp);
    if (!parent || !parent.children) { relayout(); return; }
    const idx = parent.children.findIndex(c => c.path === path);
    const old = idx >= 0 ? parent.children[idx] : null;
    const delta = (node.size || 0) - (old ? (old.size || 0) : 0);
    if (idx >= 0) parent.children[idx] = node; else parent.children.push(node);
    if (delta) {
      let cur = state.tree;
      let guard = 0;
      while (cur && cur.path !== path && guard++ < 64) {
        cur.size = (cur.size || 0) + delta;
        cur = (cur.children || []).find(c => path === c.path || path.startsWith(c.path + '/'));
      }
    }
    relayout();
  }

  // --- fs change pulse + refetch ----------------------------------------------
  function onFsChanged({ path } = {}) {
    if (!path) return;
    const ln = nodeForPathOrAncestor(path);
    pulses.set(ln ? ln.path : path, performance.now());
    markDirty();

    if (!state.tree) return;
    const rootPath = state.tree.path;
    let parent = path === rootPath ? rootPath : dirnameOf(path);
    if (!parent.startsWith(rootPath)) parent = rootPath;
    if (inflight.has(parent)) return;
    inflight.add(parent);
    Promise.resolve(api.getTree(parent)).then(node => {
      inflight.delete(parent);
      if (node) bus.emit('subtree:updated', { path: parent, node });
    }).catch(e => { inflight.delete(parent); console.error('filespace subtree refetch', e); });
  }

  // --- release particles --------------------------------------------------------
  function launchRelease(paths) {
    if (!paths || !paths.length) return;
    const group = { paths: paths.slice(), remaining: paths.length };
    const now = performance.now();
    const stagger = Math.min(70, 240 / Math.max(1, paths.length - 1));
    paths.forEach((p, i) => {
      const ln = nodeForPathOrAncestor(p);
      const h = hashStr(p);
      const x0 = ln ? ln.x : (layout.carve ? layout.carve.x + layout.carve.w / 2 : world.w / 2);
      const y0 = ln ? ln.y : layout.block.y + layout.block.h * 0.4;
      particles.push({
        x0, y0,
        exitY: Math.min(cam.y, 0) - 80,
        t0: now + i * stagger,
        dur: 780 + (h % 160),
        drift: ((h >>> 8) % 2 ? 1 : -1) * (3 + (h >>> 4) % 7),
        crossed: false,
        group,
      });
    });
    markDirty();
  }

  // --- tooltip -------------------------------------------------------------
  let ttFor = null;
  function tooltipRow(text, dim, monoFont) {
    const d = document.createElement('div');
    d.textContent = text;
    d.style.fontSize = monoFont ? '10px' : '11px';
    if (monoFont) d.style.fontFamily = theme.mono;
    d.style.color = dim ? theme.inkDim : theme.ink;
    d.style.lineHeight = '1.5';
    return d;
  }
  function showTooltip(ln, ev) {
    if (!tooltip) return;
    if (ttFor !== ln) {
      ttFor = ln;
      tooltip.textContent = '';
      const name = tooltipRow(ln.node.name || '?', false);
      name.style.fontWeight = '600';
      name.style.fontSize = '12px';
      tooltip.appendChild(name);
      if (ln.kind === 'more') {
        tooltip.appendChild(tooltipRow(`${ln.node.count || ''} collapsed · ${fmtBytes(ln.node.size || 0)}`, true, true));
      } else {
        tooltip.appendChild(tooltipRow(`${ln.node.kind} · ${fmtBytes(ln.node.size || 0)}`, true, true));
        tooltip.appendChild(tooltipRow(`modified ${fmtDate(ln.node.mtime)}`, true, true));
        const st = effStates(ln);
        if (st.length) {
          const row = tooltipRow(st.join(' · '), true, true);
          row.style.color = theme.accent;
          row.style.opacity = '0.85';
          tooltip.appendChild(row);
        }
      }
      tooltip.classList.remove('hidden');
    }
    const pad = 14;
    const tw = tooltip.offsetWidth || 220, th = tooltip.offsetHeight || 80;
    let lx = ev.clientX + pad, ly = ev.clientY + pad + 2;
    if (lx + tw > window.innerWidth - 8) lx = ev.clientX - tw - pad;
    if (ly + th > window.innerHeight - 8) ly = ev.clientY - th - pad;
    tooltip.style.left = lx + 'px';
    tooltip.style.top = ly + 'px';
  }
  function hideTooltip() {
    ttFor = null;
    if (tooltip) tooltip.classList.add('hidden');
  }

  // --- interaction -------------------------------------------------------------
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const wx = sx / cam.z + cam.x, wy = sy / cam.z + cam.y;
    const nz = Math.min(8, Math.max(0.5, cam.z * Math.exp(-e.deltaY * 0.0016)));
    if (nz === cam.z) return;
    cam.z = nz;
    cam.x = wx - sx / nz;
    cam.y = wy - sy / nz;
    userMoved = true;
    markDirty();
  }, { passive: false });

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    canvas.setPointerCapture(e.pointerId);
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    const wp = toWorld(sx, sy);
    const hit = hitTest(wp);
    drag = { mode: hit ? 'maybe' : 'pan', sx, sy, wp0: wp, hit, moved: 0 };
    hideTooltip();
  });

  canvas.addEventListener('pointermove', (e) => {
    const r = canvas.getBoundingClientRect();
    const sx = e.clientX - r.left, sy = e.clientY - r.top;
    if (drag) {
      const dx = sx - drag.sx, dy = sy - drag.sy;
      drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      if (drag.mode === 'pan') {
        cam.x -= (sx - (drag.lx ?? drag.sx)) / cam.z;
        cam.y -= (sy - (drag.ly ?? drag.sy)) / cam.z;
        drag.lx = sx; drag.ly = sy;
        userMoved = true;
        canvas.style.cursor = 'grabbing';
        markDirty();
      } else if (drag.mode === 'maybe' && drag.moved > 4) {
        drag.mode = 'lasso';
        drag.wp1 = toWorld(sx, sy);
        canvas.style.cursor = 'crosshair';
        markDirty();
      } else if (drag.mode === 'lasso') {
        drag.wp1 = toWorld(sx, sy);
        markDirty();
      }
      return;
    }
    const wp = toWorld(sx, sy);
    const hit = hitTest(wp);
    if (hit !== hoverNode) {
      hoverNode = hit;
      hoverSubtree = hit ? subtreeIds(hit) : null;
      markDirty();
    }
    canvas.style.cursor = hit ? 'pointer' : 'grab';
    if (hit) showTooltip(hit, e); else hideTooltip();
  });

  canvas.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag;
    drag = null;
    canvas.style.cursor = hoverNode ? 'pointer' : 'grab';
    if (d.mode === 'lasso' && d.wp1) {
      const x0 = Math.min(d.wp0.x, d.wp1.x), x1 = Math.max(d.wp0.x, d.wp1.x);
      const y0 = Math.min(d.wp0.y, d.wp1.y), y1 = Math.max(d.wp0.y, d.wp1.y);
      const picked = layout.nodes
        .filter(n => n.kind !== 'more' && n.path
          && n.x + n.r > x0 && n.x - n.r < x1 && n.y + n.r > y0 && n.y - n.r < y1)
        .map(n => n.path);
      if (e.shiftKey && state.selection) for (const p of state.selection) if (!picked.includes(p)) picked.push(p);
      setSelection(picked);
      markDirty();
      return;
    }
    if (d.moved <= 4) {
      if (d.hit && d.hit.kind !== 'more' && d.hit.path) {
        if (e.shiftKey) toggleSelection(d.hit.path);
        else setSelection([d.hit.path]);
      } else if (!d.hit) {
        clearSelection();
      }
      markDirty();
    }
  });

  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => {
    hoverNode = null; hoverSubtree = null; hideTooltip(); markDirty();
  });

  // --- bus subscriptions ---------------------------------------------------------
  bus.on('tree:updated', ({ tree } = {}) => {
    if (tree && state.tree !== tree) state.tree = tree;
    metaFetched = false;
    relayout();
    if (!metaFetched) { metaFetched = true; fetchMeta(); }
  });
  bus.on('subtree:updated', ({ path, node } = {}) => patchSubtree(path, node));
  bus.on('disk:updated', ({ disk } = {}) => {
    if (disk) state.disk = disk;
    relayout();
  });
  bus.on('fs:changed', onFsChanged);
  bus.on('selection:changed', markDirty);
  bus.on('meta:updated', ({ metas } = {}) => {
    if (metas && state.metas instanceof Map) {
      for (const [p, st] of Object.entries(metas)) state.metas.set(p, st);
    }
    markDirty();
  });
  bus.on('release:start', ({ paths } = {}) => launchRelease(paths));
  bus.on('proposal:resolved', () => {
    Promise.resolve(api.getTree()).then(tree => {
      if (tree && state.tree) Object.assign(state.tree, tree);
      else if (tree) state.tree = tree;
      relayout();
    }).catch(e => console.error('filespace tree refresh', e));
  });
  bus.on('layer:changed', markDirty);

  const ro = ('ResizeObserver' in window) ? new ResizeObserver(resize) : null;
  if (ro) ro.observe(host);
  window.addEventListener('resize', resize);
  resize();
  if (state.tree) {
    relayout();
    if (!metaFetched) { metaFetched = true; fetchMeta(); }
  }

  // --- drawing helpers -----------------------------------------------------------
  // `slot` lets a node cache more than one ellipsized string (name vs size)
  // without thrashing a single cache key every frame.
  function ellipsize(ln, text, maxW, font, slot) {
    const kKey = '_lblKey' + (slot || ''), kVal = '_lbl' + (slot || '');
    const key = text + '|' + Math.round(maxW);
    if (ln[kKey] === key) return ln[kVal];
    ctx.font = font;
    let s = text;
    if (ctx.measureText(s).width > maxW) {
      let lo = 0, hi = s.length;
      while (lo < hi) {
        const mid = (lo + hi + 1) >> 1;
        if (ctx.measureText(s.slice(0, mid) + '…').width <= maxW) lo = mid; else hi = mid - 1;
      }
      s = lo > 0 ? s.slice(0, lo) + '…' : '';
    }
    ln[kKey] = key;
    ln[kVal] = s;
    return s;
  }

  function visibleWorld() {
    const m = 40; // margin so links entering view still draw
    return {
      x0: cam.x - m, y0: cam.y - m,
      x1: cam.x + cssW / cam.z + m, y1: cam.y + cssH / cam.z + m,
    };
  }

  // --- scene passes ------------------------------------------------------------
  function drawMarble() {
    const b = layout.block;
    ctx.fillStyle = theme.marble;
    ctx.fillRect(b.x, b.y, b.w, b.h);
    const g = ctx.createLinearGradient(0, b.y, 0, b.y + b.h);
    g.addColorStop(0, 'rgba(255,255,255,0.022)');
    g.addColorStop(0.5, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(0,0,0,0.25)');
    ctx.fillStyle = g;
    ctx.fillRect(b.x, b.y, b.w, b.h);

    ctx.lineWidth = 1;
    for (const s of STRATA) {
      const y0 = b.y + s.f * b.h;
      ctx.strokeStyle = rgba(theme.vein, s.alpha);
      ctx.beginPath();
      for (let x = b.x; x <= b.x + b.w; x += 26) {
        const y = y0 + Math.sin(x * s.freq + s.phase) * s.amp;
        if (x === b.x) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
  }

  // a soft luminous cavity behind the tree so it reads as carved-out space.
  function drawCavity() {
    if (!layout.carve) return;
    const bnd = layout.bounds;
    const cx = (bnd.minX + bnd.maxX) / 2;
    const top = layout.block.y;
    const bot = bnd.maxY + 24;
    const halfW = Math.max((bnd.maxX - bnd.minX) / 2 + 70, layout.carve.w / 2 + 40);
    const halfH = (bot - top) / 2;
    const my = (top + bot) / 2;
    ctx.save();
    const g = ctx.createRadialGradient(cx, my, Math.min(halfW, halfH) * 0.2, cx, my, Math.max(halfW, halfH));
    g.addColorStop(0, rgba(theme.carve, 0.92));
    g.addColorStop(0.62, rgba(theme.carve, 0.55));
    g.addColorStop(1, rgba(theme.carve, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(cx, my, halfW, halfH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();

    // luminous spill where the shaft meets the membrane.
    const sg = ctx.createLinearGradient(0, layout.block.y, 0, layout.block.y + 40);
    sg.addColorStop(0, rgba(theme.accent, 0.12));
    sg.addColorStop(1, rgba(theme.accent, 0));
    ctx.fillStyle = sg;
    ctx.fillRect(layout.carve.x - 2, layout.block.y, layout.carve.w + 4, 40);
  }

  // organic, slightly-curved tapered branch from parent bottom to child top.
  function drawLink(link, vw, now) {
    const p = link.parent, c = link.child;
    // cull if entirely off-screen
    const minX = Math.min(p.x, c.x) - 8, maxX = Math.max(p.x, c.x) + 8;
    const minY = p.y, maxY = c.y;
    if (maxX < vw.x0 || minX > vw.x1 || maxY < vw.y0 || minY > vw.y1) return;

    const sel = isSelected(c);
    const lit = (hoverSubtree && hoverSubtree.has(c.id));
    const x1 = p.x, y1 = p.y + p.r * 0.5;
    const x2 = c.x, y2 = c.y - c.r * 0.6;
    const dy = y2 - y1;
    // gentle organic bow toward the child's side
    const bow = clamp((x2 - x1) * 0.12, -22, 22);
    const c1x = x1 + bow * 0.4, c1y = y1 + dy * 0.42;
    const c2x = x2 - bow * 0.4, c2y = y2 - dy * 0.42;

    const w = Math.max(LINK_MIN * 0.8, link.w);

    // gradient: vein→carve along the branch, brightening near the nodes.
    const grad = ctx.createLinearGradient(x1, y1, x2, y2);
    let near, mid;
    if (sel) { near = brighten(theme.accent, 0.1); mid = mix(theme.accent, branchDim, 0.55); }
    else if (lit) { near = brighten(theme.accent, 0.0); mid = mix(theme.accent, branchDim, 0.7); }
    else { near = mix(theme.line, theme.vein, 0.4); mid = branchDim; }
    grad.addColorStop(0, rgba(near, sel || lit ? 0.85 : 0.7));
    grad.addColorStop(0.5, rgba(mid, sel || lit ? 0.75 : 0.5));
    grad.addColorStop(1, rgba(near, sel || lit ? 0.95 : 0.78));

    // taper: draw the branch as a filled quad-ish ribbon (wide at parent,
    // narrowing toward child) using two offset beziers.
    const wp = w, wc = Math.max(LINK_MIN * 0.7, w * 0.55);
    ctx.save();
    if (sel || lit) {
      ctx.shadowColor = rgba(theme.accent, 0.4);
      ctx.shadowBlur = 6;
    }
    ctx.beginPath();
    ctx.moveTo(x1 - wp / 2, y1);
    ctx.bezierCurveTo(c1x - wp / 2, c1y, c2x - wc / 2, c2y, x2 - wc / 2, y2);
    ctx.lineTo(x2 + wc / 2, y2);
    ctx.bezierCurveTo(c2x + wc / 2, c2y, c1x + wp / 2, c1y, x1 + wp / 2, y1);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
  }

  function drawTrunk() {
    // the trunk descends from the membrane into the root node.
    const root = layout.nodes[0];
    if (!root) return;
    const x = root.x;
    const yTop = layout.block.y;
    const yBot = root.y - root.r * 0.4;
    const w = LINK_MAX;
    const grad = ctx.createLinearGradient(0, yTop, 0, yBot);
    grad.addColorStop(0, rgba(theme.accent, 0.32));
    grad.addColorStop(0.4, rgba(mix(theme.accent, branchDim, 0.6), 0.55));
    grad.addColorStop(1, rgba(mix(theme.line, theme.vein, 0.4), 0.78));
    ctx.beginPath();
    ctx.moveTo(x - w / 2, yTop);
    ctx.lineTo(x - w / 2 * 0.8, yBot);
    ctx.lineTo(x + w / 2 * 0.8, yBot);
    ctx.lineTo(x + w / 2, yTop);
    ctx.closePath();
    ctx.fillStyle = grad;
    ctx.fill();
  }

  function drawHints() {
    for (const h of layout.hints) {
      const grad = ctx.createLinearGradient(0, h.y, 0, h.y + h.len);
      grad.addColorStop(0, rgba(mix(theme.line, theme.carve, 0.4), 0.5));
      grad.addColorStop(1, rgba(theme.carve, 0));
      ctx.strokeStyle = grad;
      ctx.lineWidth = 2;
      ctx.setLineDash([2, 4]);
      ctx.beginPath();
      ctx.moveTo(h.x, h.y);
      ctx.lineTo(h.x, h.y + h.len);
      ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  // state ring/arc around a node.
  function drawStateRings(ln, r, now) {
    const states = ln.kind === 'more' ? [] : effStates(ln);
    if (!states.length) return;

    // published → full gold ring + glow.
    if (states.includes('published')) {
      ctx.save();
      ctx.shadowColor = rgba(theme.gold, 0.6);
      ctx.shadowBlur = 12;
      ctx.strokeStyle = theme.gold;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.arc(ln.x, ln.y, r + 3.5, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // agent-accessible → violet dashed ring.
    if (states.includes('agent-accessible')) {
      ctx.save();
      ctx.setLineDash([3, 3]);
      ctx.strokeStyle = rgba(theme.violet, 0.9);
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(ln.x, ln.y, r + (states.includes('published') ? 6 : 3.5), 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
    // synced / downloaded / shared → colored arcs around the node.
    const arcs = [];
    if (states.includes('synced')) arcs.push(theme.accent);
    if (states.includes('downloaded')) arcs.push(theme.down);
    if (states.includes('shared')) arcs.push(theme.green);
    if (arcs.length) {
      const rr = r + 2.5;
      const span = (Math.PI * 1.4) / arcs.length;
      let a0 = -Math.PI * 0.7;
      ctx.lineWidth = 1.8;
      ctx.lineCap = 'round';
      for (const col of arcs) {
        ctx.strokeStyle = col;
        ctx.beginPath();
        ctx.arc(ln.x, ln.y, rr, a0 + span * 0.08, a0 + span * 0.92);
        ctx.stroke();
        a0 += span;
      }
      ctx.lineCap = 'butt';
    }
    // checkpointed → small ◆ beside the node.
    if (states.includes('checkpointed')) {
      ctx.font = `${Math.max(8, Math.min(11, r))}px ${theme.font}`;
      ctx.fillStyle = rgba(theme.gold, 0.9);
      ctx.textBaseline = 'middle';
      ctx.fillText('◆', ln.x + r + 2.5, ln.y);
    }
  }

  function drawNode(ln, now, vw) {
    if (ln.x + ln.r < vw.x0 || ln.x - ln.r > vw.x1 || ln.y + ln.r < vw.y0 || ln.y - ln.r > vw.y1) return;
    const isDir = ln.node.kind === 'dir';
    const isMore = ln.kind === 'more';
    const isRoot = ln.depth === 0;
    const hov = ln === hoverNode;
    const sel = isSelected(ln);
    const r = ln.r;
    const breath = 0.94 + 0.04 * Math.sin(now * 0.0011 * ln.jit + ln.phase);

    if (isMore) {
      ctx.save();
      ctx.globalAlpha = 0.9 * breath;
      ctx.setLineDash([2, 2]);
      ctx.fillStyle = rgba(brighten(theme.carve, 0.14), 0.85);
      ctx.beginPath();
      ctx.arc(ln.x, ln.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = rgba(theme.line, 0.6);
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.restore();
      // label only when zoomed enough AND there's room (collision-aware).
      const screenR = r * cam.z;
      if (screenR >= LABEL_SCREEN_R || cam.z >= LABEL_Z) {
        drawLabel(ln, r, screenR, hov, sel, true);
      }
      return;
    }

    // glow halo under nodes — subtle, brighter when hovered/selected.
    const haloA = hov ? 0.34 : sel ? 0.26 : 0.14;
    const haloC = hov || sel ? theme.accent : (isDir ? theme.accent : theme.chamberHot);
    const halo = ctx.createRadialGradient(ln.x, ln.y, r * 0.5, ln.x, ln.y, r * 2.4);
    halo.addColorStop(0, rgba(haloC, haloA));
    halo.addColorStop(1, rgba(haloC, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(ln.x, ln.y, r * 2.4, 0, Math.PI * 2);
    ctx.fill();

    // node disc
    let fill = isDir ? dirFill : fileFill;
    if (isRoot) fill = mix(theme.chamber, theme.accent, 0.18);
    if (hov) fill = theme.chamberHot;
    ctx.save();
    ctx.globalAlpha = breath;
    ctx.beginPath();
    ctx.arc(ln.x, ln.y, r, 0, Math.PI * 2);
    // inner sheen
    const sheen = ctx.createRadialGradient(ln.x - r * 0.35, ln.y - r * 0.45, r * 0.1, ln.x, ln.y, r);
    sheen.addColorStop(0, brighten(fill, isDir ? 0.22 : 0.16));
    sheen.addColorStop(1, fill);
    ctx.fillStyle = sheen;
    ctx.fill();
    ctx.restore();

    // rim — brighter for dirs, accent on hover
    ctx.strokeStyle = hov ? theme.accent
      : isRoot ? rgba(theme.accent, 0.7)
        : isDir ? rgba(brighten(theme.line, 0.4), 0.9)
          : rgba(theme.line, 0.7);
    ctx.lineWidth = isDir ? 1.3 : 1;
    ctx.beginPath();
    ctx.arc(ln.x, ln.y, r, 0, Math.PI * 2);
    ctx.stroke();

    // opaque (skipped) dirs get a hatched look
    if (effStates(ln).includes('opaque')) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(ln.x, ln.y, r - 0.5, 0, Math.PI * 2);
      ctx.clip();
      ctx.strokeStyle = rgba(theme.line, 0.25);
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (let lx = ln.x - r; lx < ln.x + r; lx += 4) {
        ctx.moveTo(lx, ln.y + r);
        ctx.lineTo(lx + r * 2, ln.y - r);
      }
      ctx.stroke();
      ctx.restore();
    }

    drawStateRings(ln, r, now);

    // selection ring + glow
    if (sel) {
      ctx.save();
      ctx.shadowColor = rgba(theme.accent, 0.55);
      ctx.shadowBlur = 10;
      ctx.strokeStyle = theme.accent;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(ln.x, ln.y, r + 2, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // hot pulse (fs:changed)
    const t0 = pulses.get(ln.path);
    if (t0 !== undefined) {
      const k = 1 - (now - t0) / PULSE_MS;
      if (k > 0) {
        ctx.save();
        ctx.shadowColor = theme.hot;
        ctx.shadowBlur = 20 * k;
        ctx.strokeStyle = rgba(theme.hot, 0.85 * k);
        ctx.lineWidth = 1.6;
        ctx.beginPath();
        ctx.arc(ln.x, ln.y, r + 3 + (1 - k) * 6, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }
    }

    // labels — only when on-screen radius ≥ ~7px OR zoom ≥ ~1.3, and only when
    // there's horizontal room before the next sibling so labels never collide.
    const screenR = r * cam.z;
    if (screenR >= LABEL_SCREEN_R || cam.z >= LABEL_Z) {
      drawLabel(ln, r, screenR, hov, sel, isMore);
    }
  }

  // Right-side label with collision suppression + width clamping. Width is
  // bounded by both a global max and the world-space gap to the next same-depth
  // node (ln.labelRoom). Below a minimum legible width the label is suppressed
  // (unless the node is hovered/selected — those are always worth showing).
  function drawLabel(ln, r, screenR, hov, sel, isMore) {
    // Only the hovered node forces a full-width label (it's the single focus,
    // drawn on top last). Selected nodes read brighter but still respect the
    // collision room so selecting a whole subtree doesn't re-spam labels.
    const roomWorld = (ln.labelRoom === undefined) ? Infinity : ln.labelRoom;
    const roomScreen = roomWorld === Infinity ? Infinity : roomWorld * cam.z;
    let avail = Math.min(LABEL_MAX_SCREEN_W, roomScreen);
    if (!hov && avail < LABEL_MIN_SCREEN_W) return; // not enough room → no spam
    if (hov) avail = Math.max(avail, LABEL_MAX_SCREEN_W); // ensure focus is readable
    const maxWorld = avail / cam.z;

    const lx = ln.x + r + LABEL_GAP;
    ctx.textBaseline = 'middle';
    if (isMore) {
      ctx.font = `10px ${theme.font}`;
      ctx.fillStyle = rgba(theme.inkDim, 0.75);
      ctx.fillText(ellipsize(ln, ln.node.name || '…', maxWorld, `10px ${theme.font}`), lx, ln.y);
      return;
    }
    ctx.font = `11px ${theme.font}`;
    ctx.fillStyle = hov || sel ? theme.ink : theme.inkDim;
    const name = ellipsize(ln, ln.node.name || '', maxWorld, `11px ${theme.font}`);
    if (!name) return;
    // size below name when there's clearly room (larger nodes / higher zoom)
    const showSize = (screenR >= 11 || cam.z >= 1.8);
    if (showSize) {
      ctx.fillText(name, lx, ln.y - 5);
      ctx.font = `9px ${theme.mono}`;
      ctx.fillStyle = rgba(theme.inkDim, 0.8);
      ctx.fillText(ellipsize(ln, fmtBytes(ln.node.size || 0), maxWorld, `9px ${theme.mono}`, 'Sz'), lx, ln.y + 6);
    } else {
      ctx.fillText(name, lx, ln.y);
    }
  }

  function drawGauge() {
    if (!state.disk || !state.disk.total) return;
    const b = layout.block;
    const used = state.disk.used != null ? state.disk.used : state.disk.total - (state.disk.free || 0);
    const x0 = b.x + 12, x1 = b.x + b.w - 12;
    const yb = b.y + b.h - 12;
    ctx.strokeStyle = rgba(theme.line, 0.5);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x0, yb + 2.5); ctx.lineTo(x1, yb + 2.5);
    ctx.stroke();
    ctx.fillStyle = rgba(theme.inkDim, 0.85);
    ctx.fillRect(x0, yb, Math.max(1, (x1 - x0) * Math.min(1, used / state.disk.total)), 5);
    ctx.font = `9px ${theme.mono}`;
    ctx.textAlign = 'right';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = rgba(theme.inkDim, 0.9);
    ctx.fillText(`${fmtBytes(used)} / ${fmtBytes(state.disk.total)}`, x1, yb - 5);
    ctx.textAlign = 'left';
  }

  function drawWalls() {
    const b = layout.block;
    let g = ctx.createLinearGradient(b.x, 0, b.x + 16, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(b.x, b.y, 16, b.h);
    g = ctx.createLinearGradient(b.x + b.w, 0, b.x + b.w - 16, 0);
    g.addColorStop(0, 'rgba(0,0,0,0.32)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(b.x + b.w - 16, b.y, 16, b.h);
    g = ctx.createLinearGradient(0, b.y + b.h, 0, b.y + b.h - 16);
    g.addColorStop(0, 'rgba(0,0,0,0.38)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g; ctx.fillRect(b.x, b.y + b.h - 16, b.w, 16);
    ctx.fillStyle = wallFill;
    ctx.fillRect(b.x, b.y, 3, b.h);
    ctx.fillRect(b.x + b.w - 3, b.y, 3, b.h);
    ctx.fillRect(b.x, b.y + b.h - 3, b.w, 3);
  }

  function drawMembrane(now) {
    const m = layout.membrane;
    ctx.save();
    ctx.beginPath(); ctx.rect(m.x, m.y - 1, m.w, m.h + 1); ctx.clip();
    let g = ctx.createLinearGradient(0, m.y, 0, m.y + m.h);
    g.addColorStop(0, rgba(theme.accent, 0.015));
    g.addColorStop(1, rgba(theme.accent, 0.07));
    ctx.fillStyle = g;
    ctx.fillRect(m.x, m.y, m.w, m.h);
    for (let k = 0; k < 2; k++) {
      const ph = ((now / 8000) + k * 0.5) % 1;
      const cx = m.x - 170 + ph * (m.w + 340);
      g = ctx.createLinearGradient(cx - 160, 0, cx + 160, 0);
      g.addColorStop(0, rgba(theme.accent, 0));
      g.addColorStop(0.5, rgba(theme.accent, 0.11));
      g.addColorStop(1, rgba(theme.accent, 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - 160, m.y, 320, m.h);
    }
    ctx.restore();
    ctx.save();
    ctx.shadowColor = rgba(theme.accent, 0.5);
    ctx.shadowBlur = 6;
    ctx.strokeStyle = rgba(theme.accent, 0.8);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(m.x, m.y + m.h - 0.5);
    ctx.lineTo(m.x + m.w, m.y + m.h - 0.5);
    ctx.stroke();
    ctx.restore();
    for (let i = ripples.length - 1; i >= 0; i--) {
      const rp = ripples[i];
      const p = (now - rp.t0) / 700;
      if (p >= 1) { ripples.splice(i, 1); continue; }
      const a = (1 - p) * 0.8;
      ctx.strokeStyle = rgba(theme.gold, a);
      ctx.lineWidth = 1.25;
      ctx.beginPath();
      ctx.arc(rp.x, m.y + m.h, 4 + p * 28, Math.PI, 2 * Math.PI);
      ctx.stroke();
      ctx.strokeStyle = rgba(theme.gold, a * 0.9);
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(rp.x - 30 * p - 4, m.y + m.h - 0.5);
      ctx.lineTo(rp.x + 30 * p + 4, m.y + m.h - 0.5);
      ctx.stroke();
    }
  }

  function drawParticles(now) {
    const mY = layout.membrane.y + layout.membrane.h;
    for (let i = particles.length - 1; i >= 0; i--) {
      const pt = particles[i];
      const t = now - pt.t0;
      if (t < 0) {
        ctx.save();
        ctx.shadowColor = theme.gold;
        ctx.shadowBlur = 10;
        ctx.fillStyle = rgba(theme.gold, 0.5);
        ctx.beginPath();
        ctx.arc(pt.x0, pt.y0, 2.2, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      const p = t / pt.dur;
      if (p >= 1) {
        particles.splice(i, 1);
        pt.group.remaining--;
        if (pt.group.remaining === 0) {
          try { bus.emit('release:landed', { paths: pt.group.paths }); }
          catch (e) { console.error(e); }
        }
        continue;
      }
      const ease = p * p;
      const y = pt.y0 + (pt.exitY - pt.y0) * ease;
      const x = pt.x0 + Math.sin(p * Math.PI) * pt.drift;
      if (!pt.crossed && y <= mY) {
        pt.crossed = true;
        ripples.push({ x, t0: now });
      }
      const dBand = Math.abs(y - (mY - layout.membrane.h / 2));
      const squeeze = Math.max(0, 1 - dBand / (layout.membrane.h + 14));
      const sx = 1 - 0.55 * squeeze, sy = 1 + 0.8 * squeeze;
      ctx.save();
      const trail = ctx.createLinearGradient(0, y, 0, y + 34);
      trail.addColorStop(0, rgba(theme.gold, 0.4));
      trail.addColorStop(1, rgba(theme.gold, 0));
      ctx.strokeStyle = trail;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x, y + 34);
      ctx.stroke();
      ctx.shadowColor = theme.gold;
      ctx.shadowBlur = 16;
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      ctx.fillStyle = rgba(theme.gold, 0.95);
      ctx.beginPath();
      ctx.arc(0, 0, 3.2, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,248,230,0.95)';
      ctx.beginPath();
      ctx.arc(0, 0, 1.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  function drawLasso() {
    if (!drag || drag.mode !== 'lasso' || !drag.wp1) return;
    const x = Math.min(drag.wp0.x, drag.wp1.x), y = Math.min(drag.wp0.y, drag.wp1.y);
    const w = Math.abs(drag.wp1.x - drag.wp0.x), h = Math.abs(drag.wp1.y - drag.wp0.y);
    ctx.fillStyle = rgba(theme.accent, 0.08);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = rgba(theme.accent, 0.8);
    ctx.lineWidth = 1 / cam.z;
    ctx.strokeRect(x, y, w, h);
  }

  function draw(now) {
    for (const [p, t0] of pulses) if (now - t0 > PULSE_MS) pulses.delete(p);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = theme.bg;
    ctx.fillRect(0, 0, cssW, cssH);
    ctx.setTransform(dpr * cam.z, 0, 0, dpr * cam.z, -cam.x * cam.z * dpr, -cam.y * cam.z * dpr);

    drawMarble();
    drawCavity();

    const vw = visibleWorld();
    // links first (under nodes), then trunk, then nodes on top.
    for (const link of layout.links) drawLink(link, vw, now);
    drawTrunk();
    drawHints();
    for (const ln of layout.nodes) drawNode(ln, now, vw);
    // hovered node's label on top of everything so it's never occluded by a
    // neighbouring disc/halo drawn later in the array.
    if (hoverNode) {
      drawLabel(hoverNode, hoverNode.r, hoverNode.r * cam.z, true, isSelected(hoverNode), hoverNode.kind === 'more');
    }

    drawGauge();
    drawWalls();
    drawMembrane(now);
    drawParticles(now);
    drawLasso();
  }

  // --- frame loop: redraw on dirty or live animation; ambient kept cheap -----------
  function frame(now) {
    requestAnimationFrame(frame);
    if (!world || cssW < 2) return;
    if (document.hidden && !dirty) return;
    const hot = pulses.size > 0 || particles.length > 0 || ripples.length > 0
      || (drag && (drag.mode === 'pan' || drag.mode === 'lasso'));
    if (!dirty && !hot) {
      const ambientEvery = (state.layer || 'filespace') === 'filespace' ? 33 : 130;
      if (now - lastDraw < ambientEvery) return;
    }
    dirty = false;
    lastDraw = now;
    draw(now);
  }
  requestAnimationFrame(frame);
}
