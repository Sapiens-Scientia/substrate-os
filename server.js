#!/usr/bin/env node
'use strict';

// Substrate OS server (Builder A). Zero dependencies, node core only.
// Binds 127.0.0.1:4173. CLI: node server.js [--root /abs/path] [--port 4173]

const http = require('node:http');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFile } = require('node:child_process');

const { assertInside, readJsonBody, sendJson, MIME_TYPES } = require('./lib/util');
const { scanTree } = require('./lib/scan');
const { metaFor } = require('./lib/meta');

const WEB_DIR = path.join(__dirname, 'web');
const DEFAULT_ROOT = path.join(__dirname, 'demo-substrate');

// ---------------------------------------------------------------- argv / root

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--root') out.root = argv[++i];
    else if (a.startsWith('--root=')) out.root = a.slice('--root='.length);
    else if (a === '--port') out.port = argv[++i];
    else if (a.startsWith('--port=')) out.port = a.slice('--port='.length);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const portArg = args.port ?? process.env.PORT;
const PORT = Number.isInteger(Number(portArg)) && Number(portArg) > 0 ? Number(portArg) : 4173;
let ROOT = args.root ? path.resolve(String(args.root)) : DEFAULT_ROOT;
const usingDefaultRoot = !args.root;

// Builder B's modules, required lazily so a missing module fails the single
// request with {error} instead of preventing the whole server from booting.
function requireEffectors() { return require('./lib/effectors'); }
function requireStore() { return require('./lib/store'); }
function requireApps() { return require('./lib/apps'); }

async function ensureRoot() {
  try {
    const st = await fsp.stat(ROOT);
    if (st.isDirectory()) return;
    console.error(`[substrate] root is not a directory: ${ROOT}`);
    process.exit(1);
  } catch { /* missing */ }
  if (!usingDefaultRoot) {
    console.error(`[substrate] root does not exist: ${ROOT}`);
    process.exit(1);
  }
  try {
    const { seed } = require('./scripts/seed-demo');
    await seed(ROOT);
    console.log(`[substrate] seeded demo substrate at ${ROOT}`);
  } catch (e) {
    console.error(`[substrate] seeder unavailable (${e.message}); creating empty root`);
    await fsp.mkdir(ROOT, { recursive: true });
  }
}

// ------------------------------------------------------------------ SSE + watch

const sseClients = new Set();

function handleEvents(req, res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(': substrate stream open\n\n');
  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
}

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const c of sseClients) {
    try { c.write(msg); } catch { sseClients.delete(c); }
  }
}

setInterval(() => {
  for (const c of sseClients) {
    try { c.write(': hb\n\n'); } catch { sseClients.delete(c); }
  }
}, 25000).unref();

let watcher = null;
let pendingChanges = new Map(); // abs path -> kind, coalesced
let flushTimer = null;

function flushChanges() {
  flushTimer = null;
  const batch = pendingChanges;
  pendingChanges = new Map();
  for (const [p, kind] of batch) broadcast('change', { path: p, kind });
}

function startWatch() {
  stopWatch();
  try {
    watcher = fs.watch(ROOT, { recursive: true }, (eventType, filename) => {
      if (!filename) return;
      const rel = filename.toString();
      const parts = rel.split(path.sep);
      if (parts.includes('.substrate') || parts.includes('.git')) return;
      pendingChanges.set(path.join(ROOT, rel), eventType);
      if (!flushTimer) flushTimer = setTimeout(flushChanges, 250); // debounce 250ms
    });
    watcher.on('error', (e) => console.error(`[substrate] watch error: ${e.message}`));
  } catch (e) {
    console.error(`[substrate] fs.watch failed: ${e.message}`);
  }
}

function stopWatch() {
  if (watcher) {
    try { watcher.close(); } catch { /* already closed */ }
    watcher = null;
  }
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  pendingChanges = new Map();
}

// ---------------------------------------------------------------------- disk

function execFileP(cmd, argv) {
  return new Promise((resolve, reject) => {
    execFile(cmd, argv, { timeout: 4000, maxBuffer: 1024 * 1024 }, (err, stdout) => {
      if (err) reject(err);
      else resolve(String(stdout));
    });
  });
}

async function diskInfo(root) {
  let total = 0;
  let free = 0;
  let used = 0;
  let mount = '/';
  let haveNumbers = false;
  try {
    const s = await fsp.statfs(root);
    total = s.blocks * s.bsize;
    free = s.bavail * s.bsize;
    used = total - s.bfree * s.bsize;
    haveNumbers = total > 0;
  } catch { /* fall through to df */ }
  try {
    const out = await execFileP('/usr/bin/df', ['-k', root]);
    const lines = out.trim().split('\n');
    const cols = lines[lines.length - 1].trim().split(/\s+/);
    if (cols.length >= 6) {
      mount = cols[cols.length - 1];
      if (!haveNumbers) {
        total = Number(cols[1]) * 1024;
        used = Number(cols[2]) * 1024;
        free = Number(cols[3]) * 1024;
      }
    }
  } catch { /* keep statfs numbers, default mount */ }
  return { total, free, used, mount };
}

// ------------------------------------------------------------------- helpers

function normalizePaths(input) {
  if (!Array.isArray(input)) return [];
  return input.filter((p) => typeof p === 'string' && p.length > 0).map((p) => assertInside(ROOT, p));
}

function badRequest(message) {
  const err = new Error(message);
  err.status = 400;
  return err;
}

function asArray(v, key) {
  if (Array.isArray(v)) return v;
  if (v && typeof v === 'object' && Array.isArray(v[key])) return v[key];
  return [];
}

async function ensureProposalPersisted(proposal) {
  try {
    const store = requireStore();
    if (!proposal || !proposal.id) return;
    let existing = null;
    if (typeof store.get === 'function') existing = await store.get(ROOT, proposal.id);
    if (!existing && typeof store.add === 'function') await store.add(ROOT, proposal);
  } catch { /* effector already persisted it, or store unavailable */ }
}

async function proposalExists(id) {
  try {
    const store = requireStore();
    if (typeof store.get !== 'function') return true; // cannot check → let effector decide
    return !!(await store.get(ROOT, id));
  } catch {
    return true;
  }
}

// ----------------------------------------------------------------- API routes

const ANALYSIS_EFFECTORS = new Set(['summarize', 'classify', 'duplicates', 'stale']);

async function handleEffector(name, req, res) {
  const body = await readJsonBody(req);
  let paths = normalizePaths(body.paths);
  if (paths.length === 0) {
    if (ANALYSIS_EFFECTORS.has(name)) paths = [ROOT]; // fall back to whole root
    else throw badRequest('paths required');
  }
  const e = requireEffectors();

  switch (name) {
    case 'summarize': {
      const r = await e.summarize(ROOT, paths);
      return sendJson(res, 200, r && r.report ? r : { report: r });
    }
    case 'classify': {
      const r = await e.classify(ROOT, paths);
      return sendJson(res, 200, { groups: asArray(r, 'groups') });
    }
    case 'duplicates': {
      const r = await e.duplicates(ROOT, paths);
      return sendJson(res, 200, { groups: asArray(r, 'groups') });
    }
    case 'stale': {
      let days = Number(body.days);
      if (!Number.isFinite(days) || days <= 0) days = 180;
      days = Math.min(days, 36500);
      const r = await e.stale(ROOT, paths, days);
      return sendJson(res, 200, { items: asArray(r, 'items') });
    }
    case 'rename': {
      const r = await e.renameProposal(ROOT, paths);
      const proposal = r && r.proposal ? r.proposal : r;
      await ensureProposalPersisted(proposal);
      return sendJson(res, 200, { proposal });
    }
    case 'release': {
      const r = await e.release(ROOT, paths);
      const released = r && Array.isArray(r.released) ? r.released : Array.isArray(r) ? r : paths;
      return sendJson(res, 200, { ok: true, released });
    }
    default:
      return sendJson(res, 404, { error: `unknown effector: ${name}` });
  }
}

async function handleApi(req, res, url) {
  const p = url.pathname;
  const m = req.method;

  if (p === '/api/root') {
    if (m === 'GET') return sendJson(res, 200, { root: ROOT });
    if (m === 'POST') {
      const body = await readJsonBody(req);
      const next = body.path;
      if (typeof next !== 'string' || !path.isAbsolute(next)) throw badRequest('path must be an absolute string');
      const resolved = path.resolve(next);
      let st;
      try { st = await fsp.stat(resolved); } catch { throw badRequest('path does not exist'); }
      if (!st.isDirectory()) throw badRequest('path is not a directory');
      ROOT = resolved;
      startWatch(); // close + rewatch on root change
      return sendJson(res, 200, { root: ROOT });
    }
    return sendJson(res, 405, { error: 'method not allowed' });
  }

  if (p === '/api/disk' && m === 'GET') {
    return sendJson(res, 200, await diskInfo(ROOT));
  }

  if (p === '/api/tree' && m === 'GET') {
    const q = url.searchParams.get('path');
    if (q) {
      const sub = assertInside(ROOT, q);
      return sendJson(res, 200, await scanTree(sub, { storeRoot: ROOT }));
    }
    return sendJson(res, 200, await scanTree(ROOT));
  }

  if (p === '/api/meta' && m === 'POST') {
    const body = await readJsonBody(req);
    if (!Array.isArray(body.paths)) throw badRequest('paths must be an array');
    if (body.paths.length > 200) throw badRequest('too many paths (max 200)');
    const paths = normalizePaths(body.paths);
    return sendJson(res, 200, { metas: await metaFor(paths, ROOT) });
  }

  const fx = p.match(/^\/api\/effector\/(summarize|classify|duplicates|stale|rename|release)$/);
  if (fx) {
    if (m !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
    return handleEffector(fx[1], req, res);
  }

  if (p === '/api/checkpoint' && m === 'POST') {
    const body = await readJsonBody(req);
    const paths = normalizePaths(body.paths);
    if (paths.length === 0) throw badRequest('paths required');
    const label = typeof body.label === 'string' && body.label.trim() ? body.label.trim() : undefined;
    const e = requireEffectors();
    const r = await e.checkpoint(ROOT, paths, label);
    return sendJson(res, 200, r && r.checkpoint ? { checkpoint: r.checkpoint } : { checkpoint: r });
  }

  if (p === '/api/checkpoints' && m === 'GET') {
    let checkpoints = [];
    try {
      const raw = await fsp.readFile(path.join(ROOT, '.substrate', 'checkpoints', 'index.json'), 'utf8');
      const data = JSON.parse(raw);
      checkpoints = Array.isArray(data) ? data : asArray(data, 'checkpoints');
    } catch { /* none yet */ }
    return sendJson(res, 200, { checkpoints });
  }

  if (p === '/api/proposals' && m === 'GET') {
    let proposals = [];
    try {
      const store = requireStore();
      const r = await store.list(ROOT);
      proposals = asArray(r, 'proposals');
    } catch { /* store unavailable → empty */ }
    proposals = proposals.filter(
      (pr) => pr && !pr.resolved && pr.status !== 'resolved' && pr.state !== 'resolved',
    );
    return sendJson(res, 200, { proposals });
  }

  const pm = p.match(/^\/api\/proposal\/([A-Za-z0-9_-]{1,64})\/(merge|discard)$/);
  if (pm) {
    if (m !== 'POST') return sendJson(res, 405, { error: 'method not allowed' });
    const [, id, action] = pm;
    if (!(await proposalExists(id))) return sendJson(res, 404, { error: 'proposal not found' });
    if (action === 'merge') {
      const e = requireEffectors();
      const r = await e.mergeProposal(ROOT, id);
      const applied = r && Array.isArray(r.applied) ? r.applied : [];
      const errors = r && Array.isArray(r.errors) ? r.errors : [];
      const ok = r && typeof r.ok === 'boolean' ? r.ok : errors.length === 0;
      return sendJson(res, 200, { ok, applied, errors });
    }
    const store = requireStore();
    await store.resolve(ROOT, id, 'discarded');
    return sendJson(res, 200, { ok: true });
  }

  // --- Installed Mac apps as effectors (Addendum §16.2) -------------------
  // GET routes are reads; the POST routes already carry the X-Substrate guard
  // via assertLocalApiRequest. apps.js enforces the arbitrary-exec guard.

  if (p === '/api/apps' && m === 'GET') {
    const apps = requireApps();
    return sendJson(res, 200, await apps.listApps());
  }

  if (p === '/api/appicon' && (m === 'GET' || m === 'HEAD')) {
    const apps = requireApps();
    const q = url.searchParams.get('path');
    if (!q) throw badRequest('path required');
    let real;
    try {
      real = await apps.resolveAllowedApp(q); // 400 if not an allowed .app
    } catch (e) {
      return sendJson(res, 404, { error: 'icon unavailable' });
    }
    let file;
    try {
      file = await apps.iconPngPath(real); // 404-tagged on any failure
    } catch {
      return sendJson(res, 404, { error: 'icon unavailable' });
    }
    let st;
    try {
      st = await fsp.stat(file);
    } catch {
      return sendJson(res, 404, { error: 'icon unavailable' });
    }
    res.writeHead(200, {
      'Content-Type': 'image/png',
      'Content-Length': st.size,
      'Cache-Control': 'max-age=86400',
    });
    if (m === 'HEAD') return res.end();
    const stream = fs.createReadStream(file);
    stream.on('error', () => { try { res.destroy(); } catch { /* gone */ } });
    return stream.pipe(res);
  }

  if (p === '/api/open-with' && m === 'POST') {
    const apps = requireApps();
    const body = await readJsonBody(req);
    const real = await apps.resolveAllowedApp(body.app); // 400 if not allowed
    const paths = normalizePaths(body.paths); // each assertInside(ROOT, p)
    return sendJson(res, 200, await apps.openWith(real, paths));
  }

  if (p === '/api/reveal' && m === 'POST') {
    const apps = requireApps();
    const body = await readJsonBody(req);
    const paths = normalizePaths(body.paths); // each assertInside(ROOT, p)
    if (paths.length === 0) throw badRequest('paths required');
    return sendJson(res, 200, await apps.reveal(paths[0]));
  }

  return sendJson(res, 404, { error: 'not found' });
}

// --------------------------------------------------------------------- static

async function serveStatic(req, res, pathname) {
  let rel;
  try { rel = decodeURIComponent(pathname); } catch { return sendJson(res, 400, { error: 'bad path' }); }
  if (rel.endsWith('/')) rel += 'index.html';
  let file = assertInside(WEB_DIR, '.' + rel); // containment vs web/, throws 400
  let st;
  try {
    st = await fsp.stat(file);
    if (st.isDirectory()) {
      file = path.join(file, 'index.html');
      st = await fsp.stat(file);
    }
  } catch {
    return sendJson(res, 404, { error: 'not found' });
  }
  const type = MIME_TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': st.size,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') return res.end();
  const stream = fs.createReadStream(file);
  stream.on('error', () => { try { res.destroy(); } catch { /* gone */ } });
  stream.pipe(res);
}

// --------------------------------------------------------------------- server

// Loopback-host check (defeats DNS rebinding) + custom-header requirement on
// mutations (forces a CORS preflight cross-origin, which is never granted).
function assertLocalApiRequest(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  if (host !== '127.0.0.1' && host !== 'localhost' && host !== '[::1]') {
    const err = new Error('forbidden host');
    err.status = 403;
    throw err;
  }
  if (req.method !== 'GET' && req.method !== 'HEAD' && !req.headers['x-substrate']) {
    const err = new Error('missing X-Substrate header');
    err.status = 403;
    throw err;
  }
}

async function handle(req, res) {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname.startsWith('/api/')) assertLocalApiRequest(req);
  if (url.pathname === '/api/events' && req.method === 'GET') return handleEvents(req, res);
  if (url.pathname.startsWith('/api/')) return handleApi(req, res, url);
  if (req.method === 'GET' || req.method === 'HEAD') return serveStatic(req, res, url.pathname);
  return sendJson(res, 405, { error: 'method not allowed' });
}

const server = http.createServer((req, res) => {
  handle(req, res).catch((err) => {
    const status = err && Number.isInteger(err.status) ? err.status : 500;
    if (status >= 500) console.error('[substrate]', err);
    try { sendJson(res, status, { error: err && err.message ? err.message : 'internal error' }); } catch { /* gone */ }
  });
});

server.on('clientError', (_err, socket) => {
  try { socket.end('HTTP/1.1 400 Bad Request\r\n\r\n'); } catch { /* gone */ }
});

server.on('error', (e) => {
  console.error(`[substrate] server error: ${e.message}`);
  process.exit(1);
});

process.on('uncaughtException', (e) => console.error('[substrate] uncaught:', e));
process.on('unhandledRejection', (e) => console.error('[substrate] unhandled:', e));
process.on('SIGINT', () => { stopWatch(); server.close(); process.exit(0); });

async function main() {
  await ensureRoot();
  startWatch();
  server.listen(PORT, '127.0.0.1', () => {
    console.log('');
    console.log('  S U B S T R A T E   O S');
    console.log(`  http://127.0.0.1:${PORT}`);
    console.log(`  root  ${ROOT}`);
    console.log('  walls sealed · membrane active');
    console.log('');
  });
}

main().catch((e) => {
  console.error(`[substrate] failed to start: ${e.message}`);
  process.exit(1);
});
