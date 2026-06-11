'use strict';

// Deep per-path state detection (Builder A), §13. xattr probes + .git walk-up
// + substrate-store merge. All probe failures are silently omitted.

const { execFile } = require('node:child_process');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { readStoreStates } = require('./util');

const XATTR = '/usr/bin/xattr';
const CONCURRENCY = 16;

function xattr(args) {
  return new Promise((resolve) => {
    try {
      execFile(XATTR, args, { timeout: 2000, maxBuffer: 256 * 1024 }, (err, stdout) => {
        resolve(err ? null : String(stdout));
      });
    } catch {
      resolve(null);
    }
  });
}

// Walk up from p looking for a .git entry; stop at stopDir (inclusive) or fs root.
async function hasGitAbove(p, stopDir) {
  let dir = p;
  try {
    const st = await fsp.lstat(p);
    if (!st.isDirectory()) dir = path.dirname(p);
  } catch {
    dir = path.dirname(p);
  }
  const stop = stopDir ? path.resolve(stopDir) : null;
  for (;;) {
    try {
      await fsp.lstat(path.join(dir, '.git'));
      return true;
    } catch { /* keep climbing */ }
    if (stop && dir === stop) return false;
    const parent = path.dirname(dir);
    if (parent === dir) return false; // filesystem root
    dir = parent;
  }
}

async function statesForPath(p, root, stateMap) {
  const out = new Set();

  if (root) {
    const rel = path.relative(root, p);
    const stored = stateMap[rel] || stateMap[p] || (rel === '' ? stateMap['.'] : undefined);
    if (Array.isArray(stored)) for (const s of stored) out.add(s);
  }

  const [whereFroms, listing] = await Promise.all([
    xattr(['-p', 'com.apple.metadata:kMDItemWhereFroms', p]),
    xattr([p]),
  ]);
  if (whereFroms !== null) out.add('downloaded');
  if (listing !== null && listing.includes('com.apple.quarantine')) out.add('quarantined');

  try {
    if (await hasGitAbove(p, root)) out.add('repository');
  } catch { /* omit */ }

  return [...out];
}

// metaFor(paths, root?) → { [path]: string[] }. Parallel, capped at 16.
// `root` (optional) bounds the .git walk-up and keys store-state lookup.
async function metaFor(paths, root) {
  const list = Array.isArray(paths) ? paths.filter((p) => typeof p === 'string') : [];
  const metas = {};
  if (list.length === 0) return metas;

  const stateMap = root ? await readStoreStates(root) : {};

  let next = 0;
  const workers = Array.from({ length: Math.min(CONCURRENCY, list.length) }, async () => {
    while (next < list.length) {
      const p = list[next++];
      try {
        metas[p] = await statesForPath(p, root, stateMap);
      } catch {
        metas[p] = [];
      }
    }
  });
  await Promise.all(workers);
  return metas;
}

module.exports = { metaFor };
