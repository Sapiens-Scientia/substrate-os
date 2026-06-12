// Substrate OS — Workspace: infinite zoomable canvas hosting app windows.
// Contract §10. Camera {x,y,z} → translate/scale on #workspace-canvas (origin 0 0).

import { bus } from './bus.js';
import { state, setLayer } from './state.js';

const PLANE = 100000;
const Z_MIN = 0.15;
const Z_MAX = 3;
const FS_MARGIN = 0.04;     // 4% margin on fullscreen zoom
const TWEEN_MS = 340;
const MIN_W = 240;
const MIN_H = 160;
const MM_W = 140;
const MM_H = 90;

const cam = { x: 0, y: 0, z: 1 };
const windows = new Map();  // id -> {id, el, kind, x, y, w, h}

let container = null;
let plane = null;
let minimapEl = null;
let minimapCtx = null;
let mmap = null;            // last minimap mapping, for click→world
let stageW = 0;
let stageH = 0;
let zTop = 10;
let nextId = 1;
let cascade = 0;
let focusedId = null;
let fs = null;              // {id, prev:{x,y,z}} while fullscreen-zoomed
let tweenRaf = 0;
let minimapRaf = 0;
let colors = null;
let inited = false;

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function themeColors() {
  if (colors) return colors;
  const cs = getComputedStyle(document.documentElement);
  const v = (name, fb) => (cs.getPropertyValue(name) || '').trim() || fb;
  colors = {
    accent: v('--accent', '#4cc9f0'),
    chamber: v('--chamber', '#223046'),
    line: v('--line', '#2c3a52'),
    inkDim: v('--ink-dim', '#6b7a94'),
  };
  return colors;
}

function updateStageSize() {
  const r = container.getBoundingClientRect();
  stageW = r.width;
  stageH = r.height;
}

function applyCamera() {
  if (stageW > 0 && stageH > 0) {
    cam.x = clamp(cam.x, stageW - PLANE * cam.z, 0);
    cam.y = clamp(cam.y, stageH - PLANE * cam.z, 0);
  }
  plane.style.transform = `translate(${cam.x}px, ${cam.y}px) scale(${cam.z})`;
  scheduleMinimap();
}

function centerCamera() {
  cam.z = 1;
  cam.x = stageW / 2 - PLANE / 2;
  cam.y = stageH / 2 - PLANE / 2;
  applyCamera();
}

function viewCenterWorld() {
  return {
    x: (stageW / 2 - cam.x) / cam.z,
    y: (stageH / 2 - cam.y) / cam.z,
  };
}

// ---- single rAF tween for all camera animations -------------------------

function stopTween() {
  if (tweenRaf) {
    cancelAnimationFrame(tweenRaf);
    tweenRaf = 0;
  }
}

function tweenCamera(to, ms = TWEEN_MS, done) {
  stopTween();
  const from = { x: cam.x, y: cam.y, z: cam.z };
  const t0 = performance.now();
  const ease = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
  const step = now => {
    const p = clamp((now - t0) / ms, 0, 1);
    const e = ease(p);
    cam.x = from.x + (to.x - from.x) * e;
    cam.y = from.y + (to.y - from.y) * e;
    cam.z = from.z + (to.z - from.z) * e;
    applyCamera();
    if (p < 1) tweenRaf = requestAnimationFrame(step);
    else {
      tweenRaf = 0;
      if (done) done();
    }
  };
  tweenRaf = requestAnimationFrame(step);
}

function zoomAt(px, py, factor) {
  const z = clamp(cam.z * factor, Z_MIN, Z_MAX);
  if (z === cam.z) return;
  const wx = (px - cam.x) / cam.z;
  const wy = (py - cam.y) / cam.z;
  cam.x = px - wx * z;
  cam.y = py - wy * z;
  cam.z = z;
  applyCamera();
}

// ---- fullscreen = full zoom ----------------------------------------------

function exitFullscreen() {
  if (!fs) return;
  const prev = fs.prev;
  fs = null;
  tweenCamera(prev, TWEEN_MS);
}

function toggleFullscreen(id) {
  const win = windows.get(id);
  if (!win) return;
  if (fs && fs.id === id) {
    exitFullscreen();
    return;
  }
  const prev = fs ? fs.prev : { x: cam.x, y: cam.y, z: cam.z };
  fs = { id, prev };
  focusWindow(id);
  const availW = stageW * (1 - 2 * FS_MARGIN);
  const availH = stageH * (1 - 2 * FS_MARGIN);
  const z = clamp(Math.min(availW / win.w, availH / win.h), Z_MIN, Z_MAX);
  tweenCamera({
    x: (stageW - win.w * z) / 2 - win.x * z,
    y: (stageH - win.h * z) / 2 - win.y * z,
    z,
  }, TWEEN_MS);
}

// camera was moved by hand → no longer "fullscreen"
function breakFullscreen() {
  fs = null;
}

// ---- windows --------------------------------------------------------------

function focusWindow(id) {
  const win = windows.get(id);
  if (!win) return;
  focusedId = id;
  win.el.style.zIndex = String(++zTop);
  scheduleMinimap();
}

function closeWindow(id) {
  const win = windows.get(id);
  if (!win) return;
  windows.delete(id);
  if (focusedId === id) focusedId = null;
  const el = win.el;
  el.style.pointerEvents = 'none';
  el.style.transition = 'opacity 160ms ease, transform 160ms ease';
  el.style.opacity = '0';
  el.style.transform = 'scale(0.97)';
  setTimeout(() => el.remove(), 180);
  if (fs && fs.id === id) exitFullscreen();
  scheduleMinimap();
}

function beginDrag(e, onMove, captureEl) {
  e.preventDefault();
  captureEl.setPointerCapture(e.pointerId);
  let lx = e.clientX;
  let ly = e.clientY;
  const move = ev => {
    onMove(ev.clientX - lx, ev.clientY - ly);
    lx = ev.clientX;
    ly = ev.clientY;
  };
  const up = ev => {
    captureEl.removeEventListener('pointermove', move);
    captureEl.removeEventListener('pointerup', up);
    captureEl.removeEventListener('pointercancel', up);
    if (captureEl.hasPointerCapture && captureEl.hasPointerCapture(ev.pointerId)) {
      captureEl.releasePointerCapture(ev.pointerId);
    }
  };
  captureEl.addEventListener('pointermove', move);
  captureEl.addEventListener('pointerup', up);
  captureEl.addEventListener('pointercancel', up);
}

export function openWindow(opts = {}) {
  const { title = 'Untitled', kind = 'app', render } = opts;
  const w = clamp(Math.round(opts.w || 560), MIN_W, PLANE);
  const h = clamp(Math.round(opts.h || 420), MIN_H, PLANE);
  const id = 'ws-' + nextId++;

  if (state.layer !== 'workspace') setLayer('workspace');

  const el = document.createElement('div');
  el.className = 'ws-window';
  el.dataset.kind = kind;
  el.dataset.id = id;
  Object.assign(el.style, {
    position: 'absolute',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
  });

  const titlebar = document.createElement('div');
  titlebar.className = 'ws-titlebar';
  titlebar.style.flex = '0 0 auto';
  titlebar.style.userSelect = 'none';

  const titleEl = document.createElement('span');
  titleEl.className = 'ws-title';
  titleEl.textContent = title;

  const actions = document.createElement('span');
  actions.className = 'ws-actions';

  const zoomBtn = document.createElement('button');
  zoomBtn.className = 'ws-zoom';
  zoomBtn.textContent = '⤢';
  zoomBtn.title = 'Zoom to fit';

  const closeBtn = document.createElement('button');
  closeBtn.className = 'ws-close';
  closeBtn.textContent = '✕';
  closeBtn.title = 'Close';

  actions.append(zoomBtn, closeBtn);
  titlebar.append(titleEl, actions);

  const content = document.createElement('div');
  content.className = 'ws-content';
  Object.assign(content.style, {
    flex: '1 1 auto',
    minHeight: '0',
    overflowY: 'auto',
    overflowX: 'hidden',
  });

  const grip = document.createElement('div');
  grip.className = 'ws-resize';
  Object.assign(grip.style, {
    position: 'absolute',
    right: '0',
    bottom: '0',
    width: '14px',
    height: '14px',
    cursor: 'nwse-resize',
    clipPath: 'polygon(100% 0, 100% 100%, 0 100%)',
    background: 'repeating-linear-gradient(135deg, transparent 0 3px, var(--line, #2c3a52) 3px 4px)',
    opacity: '0.9',
    zIndex: '2',
  });

  el.append(titlebar, content, grip);

  // cascade near the current view center
  const c = viewCenterWorld();
  const k = cascade++ % 8;
  const win = {
    id, el, kind,
    x: clamp(c.x - w / 2 + (k - 2) * 36, 0, PLANE - w),
    y: clamp(c.y - h / 2 + (k - 2) * 30, 0, PLANE - h),
    w, h,
  };
  el.style.left = win.x + 'px';
  el.style.top = win.y + 'px';
  el.style.width = win.w + 'px';
  el.style.height = win.h + 'px';
  windows.set(id, win);

  el.addEventListener('pointerdown', () => focusWindow(id));

  titlebar.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.target instanceof Element && e.target.closest('button'))) return;
    beginDrag(e, (dx, dy) => {
      win.x = clamp(win.x + dx / cam.z, 0, PLANE - win.w);
      win.y = clamp(win.y + dy / cam.z, 0, PLANE - win.h);
      el.style.left = win.x + 'px';
      el.style.top = win.y + 'px';
      scheduleMinimap();
    }, titlebar);
  });

  titlebar.addEventListener('dblclick', e => {
    if (e.target instanceof Element && e.target.closest('button')) return;
    toggleFullscreen(id);
  });

  grip.addEventListener('pointerdown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    focusWindow(id);
    beginDrag(e, (dx, dy) => {
      win.w = clamp(win.w + dx / cam.z, MIN_W, PLANE - win.x);
      win.h = clamp(win.h + dy / cam.z, MIN_H, PLANE - win.y);
      el.style.width = win.w + 'px';
      el.style.height = win.h + 'px';
      scheduleMinimap();
    }, grip);
  });

  zoomBtn.addEventListener('click', e => {
    e.stopPropagation();
    toggleFullscreen(id);
  });
  closeBtn.addEventListener('click', e => {
    e.stopPropagation();
    closeWindow(id);
  });

  plane.appendChild(el);
  focusWindow(id);

  if (typeof render === 'function') {
    try {
      render(content);
    } catch (err) {
      console.error('ws-window render failed:', err);
    }
  }

  // calm entrance
  el.style.opacity = '0';
  el.style.transform = 'scale(0.96)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.style.transition = 'opacity 220ms ease, transform 220ms ease';
      el.style.opacity = '1';
      el.style.transform = 'scale(1)';
      setTimeout(() => {
        el.style.transition = '';
        el.style.transform = '';
        el.style.opacity = '';
      }, 260);
    });
  });

  scheduleMinimap();
  return id;
}

// ---- minimap ----------------------------------------------------------------

function buildMinimap() {
  minimapEl = document.createElement('div');
  minimapEl.className = 'ws-minimap';
  Object.assign(minimapEl.style, {
    position: 'absolute',
    right: '14px',
    bottom: '14px',
    width: MM_W + 'px',
    height: MM_H + 'px',
    borderRadius: '10px',
    border: '1px solid var(--line, #2c3a52)',
    background: 'var(--glass, rgba(12, 16, 24, 0.72))',
    backdropFilter: 'blur(14px)',
    WebkitBackdropFilter: 'blur(14px)',
    overflow: 'hidden',
    cursor: 'pointer',
    zIndex: '2147483000',
    transition: 'opacity 280ms ease',
  });
  const on = state.layer === 'workspace';
  minimapEl.style.opacity = on ? '1' : '0';
  minimapEl.style.pointerEvents = on ? 'auto' : 'none';

  const cv = document.createElement('canvas');
  const dpr = window.devicePixelRatio || 1;
  cv.width = Math.round(MM_W * dpr);
  cv.height = Math.round(MM_H * dpr);
  cv.style.width = MM_W + 'px';
  cv.style.height = MM_H + 'px';
  cv.style.display = 'block';
  minimapEl.appendChild(cv);
  minimapCtx = cv.getContext('2d');

  minimapEl.addEventListener('click', e => {
    if (!mmap) return;
    const r = minimapEl.getBoundingClientRect();
    const wx = (e.clientX - r.left - mmap.ox) / mmap.s + mmap.minX;
    const wy = (e.clientY - r.top - mmap.oy) / mmap.s + mmap.minY;
    breakFullscreen();
    tweenCamera({
      x: stageW / 2 - wx * cam.z,
      y: stageH / 2 - wy * cam.z,
      z: cam.z,
    }, 300);
  });

  container.appendChild(minimapEl);
}

function scheduleMinimap() {
  if (minimapRaf || !minimapCtx) return;
  minimapRaf = requestAnimationFrame(drawMinimap);
}

// Re-sample CSS vars and repaint the minimap when the theme flips.
bus.on('theme:changed', () => { colors = null; scheduleMinimap(); });

function drawMinimap() {
  minimapRaf = 0;
  if (!minimapCtx) return;
  const ctx = minimapCtx;
  const dpr = window.devicePixelRatio || 1;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, MM_W, MM_H);
  const th = themeColors();
  const pad = 8;

  const vp = {
    x: -cam.x / cam.z,
    y: -cam.y / cam.z,
    w: Math.max(1, stageW) / cam.z,
    h: Math.max(1, stageH) / cam.z,
  };
  let minX = vp.x, minY = vp.y, maxX = vp.x + vp.w, maxY = vp.y + vp.h;
  for (const win of windows.values()) {
    minX = Math.min(minX, win.x);
    minY = Math.min(minY, win.y);
    maxX = Math.max(maxX, win.x + win.w);
    maxY = Math.max(maxY, win.y + win.h);
  }
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  minX -= spanX * 0.06; maxX += spanX * 0.06;
  minY -= spanY * 0.06; maxY += spanY * 0.06;

  const s = Math.min((MM_W - pad * 2) / (maxX - minX), (MM_H - pad * 2) / (maxY - minY));
  const ox = (MM_W - (maxX - minX) * s) / 2;
  const oy = (MM_H - (maxY - minY) * s) / 2;
  mmap = { minX, minY, s, ox, oy };

  // window rects (focused last, on top)
  const list = [...windows.values()].sort((a, b) =>
    (a.id === focusedId) - (b.id === focusedId));
  for (const win of list) {
    const x = ox + (win.x - minX) * s;
    const y = oy + (win.y - minY) * s;
    const w = Math.max(2, win.w * s);
    const h = Math.max(2, win.h * s);
    ctx.globalAlpha = 0.85;
    ctx.fillStyle = th.chamber;
    ctx.fillRect(x, y, w, h);
    ctx.globalAlpha = win.id === focusedId ? 0.95 : 0.6;
    ctx.strokeStyle = win.id === focusedId ? th.accent : th.line;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, Math.max(1, w - 1), Math.max(1, h - 1));
  }

  // camera viewport
  const vx = ox + (vp.x - minX) * s;
  const vy = oy + (vp.y - minY) * s;
  const vw = Math.max(2, vp.w * s);
  const vh = Math.max(2, vp.h * s);
  ctx.globalAlpha = 0.07;
  ctx.fillStyle = th.accent;
  ctx.fillRect(vx, vy, vw, vh);
  ctx.globalAlpha = 0.9;
  ctx.strokeStyle = th.accent;
  ctx.lineWidth = 1;
  ctx.strokeRect(vx + 0.5, vy + 0.5, vw - 1, vh - 1);
  ctx.globalAlpha = 1;
}

// ---- init ---------------------------------------------------------------------

export function initWorkspace(containerEl) {
  if (inited) return;
  inited = true;

  container = containerEl || document.getElementById('workspace');
  plane = document.getElementById('workspace-canvas');
  if (!plane) {
    plane = document.createElement('div');
    plane.id = 'workspace-canvas';
    container.appendChild(plane);
  }

  container.style.overflow = 'hidden';
  Object.assign(plane.style, {
    position: 'absolute',
    left: '0',
    top: '0',
    width: PLANE + 'px',
    height: PLANE + 'px',
    transformOrigin: '0 0',
    willChange: 'transform',
    // faint world-space dot grid so pan/zoom reads even on an empty plane
    backgroundImage: 'radial-gradient(circle, var(--dot, rgba(200, 212, 232, 0.05)) 1px, transparent 1.5px)',
    backgroundSize: '36px 36px',
  });

  updateStageSize();
  centerCamera();
  buildMinimap();

  // recenter once the stage first gets real dimensions (e.g. late layout)
  let sized = stageW > 0 && stageH > 0;
  const ro = new ResizeObserver(() => {
    updateStageSize();
    if (!sized && stageW > 0 && stageH > 0) {
      sized = true;
      centerCamera();
    } else {
      applyCamera();
    }
  });
  ro.observe(container);

  // wheel = zoom toward cursor; over a window (no ctrl) the content scrolls instead
  container.addEventListener('wheel', e => {
    const t = e.target instanceof Element ? e.target : null;
    if (t && t.closest('.ws-minimap')) { e.preventDefault(); return; }
    if (t && t.closest('.ws-window') && !e.ctrlKey) return;
    e.preventDefault();
    stopTween();
    breakFullscreen();
    let dy = e.deltaY;
    if (e.deltaMode === 1) dy *= 16;
    const k = e.ctrlKey ? -0.012 : -0.0015;
    const r = container.getBoundingClientRect();
    zoomAt(e.clientX - r.left, e.clientY - r.top, Math.exp(dy * k));
  }, { passive: false });

  // drag empty plane = pan (1:1, inertia-free)
  container.addEventListener('pointerdown', e => {
    if (e.button !== 0 || (e.target !== container && e.target !== plane)) return;
    stopTween();
    breakFullscreen();
    container.style.cursor = 'grabbing';
    beginDrag(e, (dx, dy) => {
      cam.x += dx;
      cam.y += dy;
      applyCamera();
    }, container);
    const restore = () => {
      container.style.cursor = '';
      container.removeEventListener('pointerup', restore);
      container.removeEventListener('pointercancel', restore);
    };
    container.addEventListener('pointerup', restore);
    container.addEventListener('pointercancel', restore);
  });

  // Esc returns from fullscreen (workspace owns its own Esc)
  window.addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    if (state.layer !== 'workspace' || !fs) return;
    e.preventDefault();
    exitFullscreen();
  });

  bus.on('layer:changed', payload => {
    const layer = payload && payload.layer;
    const on = layer === 'workspace';
    if (minimapEl) {
      minimapEl.style.opacity = on ? '1' : '0';
      minimapEl.style.pointerEvents = on ? 'auto' : 'none';
    }
    if (on) {
      updateStageSize();
      scheduleMinimap();
    }
  });

  bus.on('window:open', (opts = {}) => {
    if (state.layer !== 'workspace') {
      setLayer('workspace');
      // let the layer flip begin before the window fades in
      setTimeout(() => openWindow(opts), 160);
    } else {
      openWindow(opts);
    }
  });

  applyCamera();
}
