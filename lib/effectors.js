'use strict';
// Effector suite — all functions take (root, paths) with pre-validated absolute
// paths and operate on each path's subtree. Walks apply the same skip rules as
// scan: .git, node_modules, .Trash, .substrate, and Library directly under HOME.
// No symlink following. Response shapes per contract §8/§13/§14.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const store = require('./store');
const { assertInside } = require('./util');

const MAX_HASH_BYTES = 64 * 1024 * 1024;
const SKIP_NAMES = new Set(['.git', 'node_modules', '.Trash', '.substrate']);
const HOME = os.homedir();

function skipEntry(name, parentDir) {
  if (SKIP_NAMES.has(name)) return true;
  if (name === 'Library' && parentDir === HOME) return true;
  return false;
}

function skipPath(p) {
  return skipEntry(path.basename(p), path.dirname(p));
}

// Walk the subtrees of `paths`, deduplicating overlap. Returns
// { files: Map<absPath, {size, mtime}>, dirs: Set<absPath> }.
async function collect(root, paths) {
  const list = Array.isArray(paths) && paths.length ? paths : [root];
  const files = new Map();
  const dirs = new Set();

  async function walk(p) {
    let st;
    try {
      st = await fsp.lstat(p);
    } catch {
      return;
    }
    if (st.isSymbolicLink()) return;
    if (st.isFile()) {
      files.set(p, { size: st.size, mtime: Math.round(st.mtimeMs) });
      return;
    }
    if (!st.isDirectory()) return;
    dirs.add(p);
    let entries;
    try {
      entries = await fsp.readdir(p, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (skipEntry(e.name, p)) continue;
      const fp = path.join(p, e.name);
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) {
        await walk(fp);
      } else if (e.isFile()) {
        try {
          const s = await fsp.lstat(fp);
          if (s.isFile()) files.set(fp, { size: s.size, mtime: Math.round(s.mtimeMs) });
        } catch {
          /* vanished mid-walk */
        }
      }
    }
  }

  for (const p of list) await walk(p);
  return { files, dirs };
}

function extOf(p) {
  return path.extname(p).slice(1).toLowerCase();
}

async function exists(p) {
  try {
    await fsp.access(p);
    return true;
  } catch {
    return false;
  }
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let next = 0;
  const n = Math.max(1, Math.min(limit, items.length));
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    })
  );
  return out;
}

function sha1File(p) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1');
    const stream = fs.createReadStream(p);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// ---- summarize -------------------------------------------------------------

async function summarize(root, paths) {
  const { files, dirs } = await collect(root, paths);
  let bytes = 0;
  let newest = null;
  let oldest = null;
  let largest = null;
  const byExt = new Map();

  for (const [p, st] of files) {
    bytes += st.size;
    if (!newest || st.mtime > newest.mtime) newest = { path: p, mtime: st.mtime };
    if (!oldest || st.mtime < oldest.mtime) oldest = { path: p, mtime: st.mtime };
    if (!largest || st.size > largest.size) largest = { path: p, size: st.size };
    const ext = extOf(p);
    const t = byExt.get(ext) || { ext, count: 0, bytes: 0 };
    t.count += 1;
    t.bytes += st.size;
    byExt.set(ext, t);
  }

  const types = [...byExt.values()].sort((a, b) => b.bytes - a.bytes).slice(0, 5);
  return {
    report: {
      items: files.size + dirs.size,
      files: files.size,
      dirs: dirs.size,
      bytes,
      types,
      newest,
      oldest,
      largest,
    },
  };
}

// ---- classify --------------------------------------------------------------

const CATEGORIES = [
  ['docs', ['pdf', 'doc', 'docx', 'txt', 'md', 'rtf', 'pages']],
  ['images', ['png', 'jpg', 'jpeg', 'gif', 'svg', 'heic', 'webp']],
  ['av', ['mp4', 'mov', 'mp3', 'wav', 'm4a', 'mkv']],
  ['code', ['js', 'ts', 'py', 'swift', 'c', 'cpp', 'go', 'rs', 'sh', 'json', 'yml', 'yaml', 'html', 'css']],
  ['archives', ['zip', 'tar', 'gz', 'dmg', '7z']],
  ['data', ['csv', 'sqlite', 'db', 'parquet']],
];

const EXT_TO_LABEL = new Map();
for (const [label, exts] of CATEGORIES) {
  for (const ext of exts) EXT_TO_LABEL.set(ext, label);
}

async function classify(root, paths) {
  const { files } = await collect(root, paths);
  const groups = new Map();
  for (const [p, st] of files) {
    const label = EXT_TO_LABEL.get(extOf(p)) || 'other';
    const g = groups.get(label) || { label, count: 0, bytes: 0, paths: [] };
    g.count += 1;
    g.bytes += st.size;
    g.paths.push(p);
    groups.set(label, g);
  }
  for (const g of groups.values()) g.paths.sort();
  return { groups: [...groups.values()].sort((a, b) => b.bytes - a.bytes) };
}

// ---- duplicates ------------------------------------------------------------

async function duplicates(root, paths) {
  const { files } = await collect(root, paths);
  const bySize = new Map();
  for (const [p, st] of files) {
    if (st.size === 0 || st.size > MAX_HASH_BYTES) continue;
    const arr = bySize.get(st.size);
    if (arr) arr.push(p);
    else bySize.set(st.size, [p]);
  }

  const candidates = [];
  for (const [size, members] of bySize) {
    if (members.length >= 2) candidates.push({ size, members });
  }

  const groups = [];
  for (const { size, members } of candidates) {
    const hashes = await mapLimit(members, 8, async (p) => {
      try {
        return await sha1File(p);
      } catch {
        return null;
      }
    });
    const byHash = new Map();
    for (let i = 0; i < members.length; i++) {
      const h = hashes[i];
      if (!h) continue;
      const arr = byHash.get(h);
      if (arr) arr.push(members[i]);
      else byHash.set(h, [members[i]]);
    }
    for (const [hash, dupPaths] of byHash) {
      if (dupPaths.length < 2) continue;
      dupPaths.sort();
      groups.push({ hash, size, count: dupPaths.length, paths: dupPaths });
    }
  }

  groups.sort((a, b) => (b.count - 1) * b.size - (a.count - 1) * a.size);
  return { groups };
}

// ---- stale -----------------------------------------------------------------

async function stale(root, paths, days = 180) {
  const d = Number(days) > 0 ? Number(days) : 180;
  const cutoff = Date.now() - d * 86400000;
  const { files } = await collect(root, paths);
  const items = [];
  for (const [p, st] of files) {
    if (st.mtime < cutoff) items.push({ path: p, mtime: st.mtime, size: st.size });
  }
  items.sort((a, b) => a.mtime - b.mtime);
  return { items: items.slice(0, 500) };
}

// ---- rename proposal -------------------------------------------------------

function normalizeBasename(name) {
  let n = name.normalize('NFC').trim();
  const ext = path.extname(n);
  let stem = ext ? n.slice(0, -ext.length) : n;
  stem = stem.replace(/^copy of /i, '');
  // " copy" only before end / space / digit / dot / ")" — never inside words
  // like "copyright".
  stem = stem.replace(/ copy(?=$|[ \d.)])/gi, '');
  stem = stem.trim();
  stem = stem.replace(/[ _]/g, '-').replace(/-{2,}/g, '-');
  if (!stem) return null;
  return stem + ext.toLowerCase();
}

async function renameProposal(root, paths) {
  const { files } = await collect(root, paths);
  const actions = [];
  const planned = new Set();

  const sorted = [...files.keys()].sort();
  for (const from of sorted) {
    const base = path.basename(from);
    if (base.startsWith('.')) continue; // never touch dotfiles
    const next = normalizeBasename(base);
    if (!next || next === base) continue;
    const to = path.join(path.dirname(from), next);
    const caseOnly = to.toLowerCase() === from.toLowerCase();
    if (planned.has(to.toLowerCase())) continue;
    if (!caseOnly && (await exists(to))) continue;
    planned.add(to.toLowerCase());
    actions.push({ from, to });
  }

  const proposal = {
    id: 'p_' + crypto.randomBytes(3).toString('hex'),
    kind: 'rename',
    created: Date.now(),
    actions,
  };
  await store.addProposal(root, proposal);
  return { proposal };
}

async function mergeProposal(root, id) {
  const proposal = await store.getProposal(root, id);
  if (!proposal) throw new Error('proposal not found: ' + id);
  if (proposal.resolved) throw new Error('proposal already resolved: ' + id);

  const applied = [];
  const errors = [];
  for (const { from, to } of proposal.actions || []) {
    try {
      // Re-assert containment at merge time: proposals.json lives inside the
      // served root, so never trust persisted from/to pairs.
      assertInside(root, from);
      assertInside(root, to);
      const caseOnly = to.toLowerCase() === from.toLowerCase();
      if (!caseOnly && (await exists(to))) {
        errors.push({ from, to, error: 'target exists' });
        continue;
      }
      await fsp.rename(from, to);
      applied.push({ from, to });
    } catch (err) {
      errors.push({ from, to, error: err.message });
    }
  }
  await store.resolveProposal(root, id, 'merge');
  return { ok: true, applied, errors };
}

async function discardProposal(root, id) {
  const resolved = await store.resolveProposal(root, id, 'discard');
  if (!resolved) throw new Error('proposal not found: ' + id);
  return { ok: true };
}

// ---- checkpoint ------------------------------------------------------------

async function checkpoint(root, paths, label) {
  const list = Array.isArray(paths) && paths.length ? paths : [root];
  const id = 'c_' + crypto.randomBytes(3).toString('hex');
  const created = Date.now();
  const destBase = path.join(store.substrateDir(root), 'checkpoints', id);

  const { files } = await collect(root, list);
  let bytes = 0;
  for (const st of files.values()) bytes += st.size;

  const cpOpts = { recursive: true, force: true, filter: (src) => !skipPath(src) };
  for (const p of list) {
    const rel = path.relative(root, p);
    const dest = rel ? path.join(destBase, rel) : destBase;
    if (dest === p || (dest + path.sep).startsWith(p + path.sep)) {
      // dest lives inside src (e.g. checkpointing the root itself) — fs.cp
      // refuses self-nesting, so copy children individually, skip rules applied.
      await fsp.mkdir(dest, { recursive: true });
      const entries = await fsp.readdir(p, { withFileTypes: true });
      for (const e of entries) {
        if (skipEntry(e.name, p) || e.isSymbolicLink()) continue;
        await fsp.cp(path.join(p, e.name), path.join(dest, e.name), cpOpts);
      }
    } else {
      await fsp.mkdir(path.dirname(dest), { recursive: true });
      await fsp.cp(p, dest, cpOpts);
    }
  }

  const cp = { id, label: label || '', created, count: files.size, bytes };
  await store.addCheckpoint(root, cp);
  for (const p of list) {
    await store.addState(root, path.relative(root, p), 'checkpointed');
  }
  return { checkpoint: cp };
}

async function listCheckpoints(root) {
  return { checkpoints: await store.listCheckpoints(root) };
}

// ---- release ---------------------------------------------------------------

async function release(root, paths) {
  const released = [];
  for (const p of Array.isArray(paths) ? paths : []) {
    await store.addState(root, path.relative(root, p), 'published');
    released.push(p);
  }
  return { ok: true, released };
}

module.exports = {
  summarize,
  classify,
  duplicates,
  stale,
  renameProposal,
  mergeProposal,
  discardProposal,
  checkpoint,
  listCheckpoints,
  release,
};
