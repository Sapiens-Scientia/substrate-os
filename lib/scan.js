'use strict';

// Filesystem scanner (Builder A). Produces TreeNode per §8/§13:
// { name, path, kind: 'file'|'dir'|'more', size, mtime, states: string[], children? }

const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { readStoreStates } = require('./util');

const SKIP_NAMES = new Set(['.git', 'node_modules', '.Trash', '.substrate']);
const MAX_DEPTH = 12;
const MAX_CHILDREN = 400;
const WALK_FANOUT = 32; // per-dir concurrent lstat/recurse batch

function shouldSkip(abs, name, depth) {
  if (depth === 0) return false; // never skip the scan root itself
  if (SKIP_NAMES.has(name)) return true;
  // `Library` only when it is the user's actual ~/Library near the top of a scan
  if (name === 'Library' && depth <= 1 && abs === path.join(os.homedir(), 'Library')) return true;
  return false;
}

// Fast du-style byte sum with a hard wall-clock deadline. Partial on timeout.
async function duSum(dir, deadline) {
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    if (Date.now() > deadline) break;
    const d = stack.pop();
    let entries;
    try { entries = await fsp.readdir(d, { withFileTypes: true }); } catch { continue; }
    for (const en of entries) {
      const p = path.join(d, en.name);
      if (en.isDirectory() && !en.isSymbolicLink()) {
        stack.push(p);
      } else {
        try { total += (await fsp.lstat(p)).size; } catch { /* vanished */ }
      }
    }
  }
  return total;
}

// Cheap states at scan time: substrate-store states (keyed by relPath) merged
// with path-rule states (Downloads / iCloud).
function statesFor(abs, name, ctx) {
  const out = [];
  const rel = path.relative(ctx.storeRoot, abs);
  const stored = ctx.stateMap[rel] || ctx.stateMap[abs] || (rel === '' ? ctx.stateMap['.'] : undefined);
  if (Array.isArray(stored)) out.push(...stored);
  if (abs.split(path.sep).includes('Downloads')) out.push('downloaded');
  if (abs.includes('Mobile Documents') || abs.includes('com~apple~CloudDocs') || name.endsWith('.icloud')) {
    out.push('synced');
  }
  return [...new Set(out)];
}

async function walk(abs, name, depth, ctx) {
  let st;
  try { st = await fsp.lstat(abs); } catch { return null; }

  const node = {
    name,
    path: abs,
    kind: 'file',
    size: 0,
    mtime: Math.round(st.mtimeMs),
    states: statesFor(abs, name, ctx),
  };

  if (!st.isDirectory() || st.isSymbolicLink()) { // lstat: symlinks never followed
    node.size = st.size;
    return node;
  }

  node.kind = 'dir';

  if (shouldSkip(abs, name, depth)) {
    node.size = await duSum(abs, Date.now() + 2000);
    if (!node.states.includes('opaque')) node.states.push('opaque');
    return node; // leaf dir, no children
  }

  if (depth >= ctx.maxDepth) {
    node.size = await duSum(abs, Date.now() + 1500);
    return node;
  }

  let entries;
  try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch { return node; }

  const kids = [];
  for (let i = 0; i < entries.length; i += WALK_FANOUT) {
    const batch = entries.slice(i, i + WALK_FANOUT);
    const results = await Promise.all(
      batch.map((en) => walk(path.join(abs, en.name), en.name, depth + 1, ctx)),
    );
    for (const k of results) if (k) kids.push(k);
  }

  kids.sort((a, b) => b.size - a.size); // largest-first
  let total = 0;
  for (const k of kids) total += k.size;
  node.size = total; // recursive byte sum includes overflow

  if (kids.length > ctx.maxChildren) {
    const keep = kids.slice(0, ctx.maxChildren);
    const rest = kids.slice(ctx.maxChildren);
    let bytes = 0;
    for (const r of rest) bytes += r.size;
    keep.push({
      name: `… ${rest.length} more`,
      path: path.join(abs, `…${rest.length}-more`),
      kind: 'more',
      size: bytes,
      mtime: 0,
      states: [],
    });
    node.children = keep;
  } else {
    node.children = kids;
  }
  return node;
}

// scanTree(root, opts?) → TreeNode.
// opts.storeRoot: substrate root for state lookup when scanning a subtree.
// opts.maxDepth / opts.maxChildren: override scan caps.
async function scanTree(root, opts = {}) {
  const abs = path.resolve(root);
  const storeRoot = path.resolve(opts.storeRoot || abs);
  const ctx = {
    maxDepth: Number.isInteger(opts.maxDepth) ? opts.maxDepth : MAX_DEPTH,
    maxChildren: Number.isInteger(opts.maxChildren) ? opts.maxChildren : MAX_CHILDREN,
    storeRoot,
    stateMap: await readStoreStates(storeRoot),
  };
  const node = await walk(abs, path.basename(abs) || abs, 0, ctx);
  if (!node) {
    const err = new Error('cannot scan: ' + abs);
    err.status = 404;
    throw err;
  }
  return node;
}

module.exports = { scanTree, duSum, shouldSkip, SKIP_NAMES, MAX_DEPTH, MAX_CHILDREN };
