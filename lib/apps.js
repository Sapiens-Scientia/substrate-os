'use strict';

// Installed-Mac-app effectors (Addendum §16.2). CommonJS, node core only.
// Enumerates real *.app bundles, resolves icons, and brokers `open` launches.
//
// SECURITY: every app bundle a caller names must realpath to a path ending in
// `.app` that lives directly inside one of the allowed app roots below. This is
// the arbitrary-exec guard for `/usr/bin/open -a`. All external binaries are
// spawned via execFile (never a shell) with absolute /usr/bin paths + a timeout.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');

const PLUTIL = '/usr/bin/plutil';
const SIPS = '/usr/bin/sips';
const OPEN = '/usr/bin/open';

const EXEC_TIMEOUT = 8000;
const APP_CAP = 120;
const ICON_CACHE_DIR = path.join(os.tmpdir(), 'substrate-icons');

// Allowed top-level app roots. `Utilities` subdirs are added so enumeration and
// the containment guard both cover `Utilities/*.app` bundles.
function appRoots() {
  const home = os.homedir();
  const tops = ['/Applications', '/System/Applications', path.join(home, 'Applications')];
  const roots = [];
  for (const t of tops) {
    roots.push(t);
    roots.push(path.join(t, 'Utilities'));
  }
  return roots;
}

function execFileP(cmd, argv, opts) {
  return new Promise((resolve, reject) => {
    execFile(cmd, argv, { timeout: EXEC_TIMEOUT, maxBuffer: 4 * 1024 * 1024, ...opts }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = String(stderr || '');
        reject(err);
      } else {
        resolve(String(stdout));
      }
    });
  });
}

// True iff `realAppPath` (already realpath'd) ends in `.app` and is a direct
// child of one of the allowed roots. realpath'ing the roots too defeats symlink
// trickery (e.g. ~/Applications pointed elsewhere).
async function isAllowedAppPath(realAppPath) {
  if (typeof realAppPath !== 'string' || !realAppPath.endsWith('.app')) return false;
  const parent = path.dirname(realAppPath);
  for (const root of appRoots()) {
    let realRoot;
    try {
      realRoot = await fsp.realpath(root);
    } catch {
      continue;
    }
    if (parent === realRoot) return true;
  }
  return false;
}

// Resolves a caller-supplied app path to a vetted real `.app` bundle path, or
// throws a 400-tagged Error. This is the mandatory arbitrary-exec guard.
async function resolveAllowedApp(input) {
  if (typeof input !== 'string' || input.length === 0 || input.includes('\0')) {
    const err = new Error('invalid app path');
    err.status = 400;
    throw err;
  }
  let real;
  try {
    real = await fsp.realpath(input);
  } catch {
    const err = new Error('app not found');
    err.status = 400;
    throw err;
  }
  if (!(await isAllowedAppPath(real))) {
    const err = new Error('app not in an allowed location');
    err.status = 400;
    throw err;
  }
  return real;
}

// Reads a bundle's Info.plist as JSON via plutil. Returns {} on any failure.
async function readBundlePlist(appPath) {
  const plist = path.join(appPath, 'Contents', 'Info.plist');
  try {
    const out = await execFileP(PLUTIL, ['-convert', 'json', '-o', '-', plist]);
    const data = JSON.parse(out);
    return data && typeof data === 'object' ? data : {};
  } catch {
    return {};
  }
}

function displayNameFor(plist, appPath) {
  const candidates = [plist.CFBundleDisplayName, plist.CFBundleName];
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim();
  }
  return path.basename(appPath).replace(/\.app$/i, '');
}

// Enumerate every *.app directly inside an allowed root (incl. Utilities dirs).
async function listAppBundles() {
  const seen = new Set();
  const bundles = [];
  for (const root of appRoots()) {
    let entries;
    try {
      entries = await fsp.readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const ent of entries) {
      if (!ent.name.endsWith('.app')) continue;
      // Accept dirs and symlinks-to-dirs; the icon/open guards realpath later.
      if (!ent.isDirectory() && !ent.isSymbolicLink()) continue;
      const full = path.join(root, ent.name);
      if (seen.has(full)) continue;
      seen.add(full);
      bundles.push(full);
    }
  }
  return bundles;
}

// GET /api/apps payload: {apps:[{name, path, icon}]} sorted alpha, deduped by
// name, capped at APP_CAP.
async function listApps() {
  const bundles = await listAppBundles();
  const byName = new Map();
  // Resolve names with bounded concurrency so a big /Applications stays snappy.
  const queue = bundles.slice();
  const CONC = 12;
  async function worker() {
    for (;;) {
      const appPath = queue.shift();
      if (!appPath) return;
      const plist = await readBundlePlist(appPath);
      const name = displayNameFor(plist, appPath);
      if (!byName.has(name)) {
        byName.set(name, {
          name,
          path: appPath,
          icon: `/api/appicon?path=${encodeURIComponent(appPath)}`,
        });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONC, queue.length) }, worker));
  const apps = Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }),
  );
  return { apps: apps.slice(0, APP_CAP) };
}

// Resolves the .icns path inside a vetted bundle from CFBundleIconFile, appending
// .icns when absent. Returns null if unresolvable / outside the bundle.
async function iconFileFor(appPath, plist) {
  let icon = plist.CFBundleIconFile;
  if (typeof icon !== 'string' || !icon.trim()) return null;
  icon = icon.trim();
  if (!icon.toLowerCase().endsWith('.icns')) icon += '.icns';
  const resources = path.join(appPath, 'Contents', 'Resources');
  const icnsPath = path.join(resources, icon);
  // Keep the resolved icns strictly inside the bundle's Resources dir.
  if (icnsPath !== resources && !icnsPath.startsWith(resources + path.sep)) return null;
  try {
    const st = await fsp.stat(icnsPath);
    if (!st.isFile()) return null;
  } catch {
    return null;
  }
  return icnsPath;
}

// Produces a cached 64px PNG for a vetted app's icon. Returns the cache file
// path, or throws a 404-tagged Error on any failure (frontend falls back to a
// glyph). `realAppPath` must already be a vetted allowed bundle.
async function iconPngPath(realAppPath) {
  const sha = crypto.createHash('sha1').update(realAppPath).digest('hex');
  const cacheFile = path.join(ICON_CACHE_DIR, `${sha}.png`);
  try {
    const st = await fsp.stat(cacheFile);
    if (st.isFile() && st.size > 0) return cacheFile;
  } catch {
    /* not cached yet */
  }
  const notFound = () => {
    const err = new Error('icon unavailable');
    err.status = 404;
    return err;
  };
  const plist = await readBundlePlist(realAppPath);
  const icns = await iconFileFor(realAppPath, plist);
  if (!icns) throw notFound();
  await fsp.mkdir(ICON_CACHE_DIR, { recursive: true });
  try {
    await execFileP(SIPS, ['-s', 'format', 'png', '-Z', '64', icns, '--out', cacheFile]);
  } catch {
    throw notFound();
  }
  try {
    const st = await fsp.stat(cacheFile);
    if (!st.isFile() || st.size === 0) throw notFound();
  } catch {
    throw notFound();
  }
  return cacheFile;
}

// POST /api/open-with: `/usr/bin/open -a <app> [paths...]`. `realAppPath` is a
// vetted bundle; `paths` are already assertInside-checked absolute paths.
async function openWith(realAppPath, paths) {
  const argv = ['-a', realAppPath];
  for (const p of paths) argv.push(p);
  await execFileP(OPEN, argv);
  return { ok: true, app: realAppPath, count: paths.length };
}

// POST /api/reveal: `/usr/bin/open -R <firstPath>`. `firstPath` is already
// assertInside-checked.
async function reveal(firstPath) {
  await execFileP(OPEN, ['-R', firstPath]);
  return { ok: true, revealed: firstPath };
}

module.exports = {
  listApps,
  iconPngPath,
  openWith,
  reveal,
  resolveAllowedApp,
  // exported for completeness / potential reuse
  appRoots,
  ICON_CACHE_DIR,
};
