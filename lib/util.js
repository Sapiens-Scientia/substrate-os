'use strict';

// Shared server utilities (Builder A). CommonJS, node core only.

const path = require('node:path');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
};

// Path-containment guard. Resolves `p` (relative inputs resolve against root)
// and throws a 400-tagged Error unless the result is root itself or inside it.
// Returns the resolved absolute path.
function assertInside(root, p) {
  if (typeof p !== 'string' || p.length === 0 || p.includes('\0')) {
    const err = new Error('invalid path');
    err.status = 400;
    throw err;
  }
  const r = path.resolve(root);
  const resolved = path.resolve(r, p);
  if (resolved === r || resolved.startsWith(r + path.sep)) return resolved;
  const err = new Error('path outside root');
  err.status = 400;
  throw err;
}

// Reads and JSON-parses a request body. Caps size (default 1MB → 413).
// Empty body resolves to {}. Malformed JSON → 400-tagged Error.
function readJsonBody(req, limit = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;
    req.on('data', (c) => {
      if (done) return;
      size += c.length;
      if (size > limit) {
        done = true;
        const err = new Error('request body too large (max 1MB)');
        err.status = 413;
        reject(err);
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (done) return;
      done = true;
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        const err = new Error('invalid JSON body');
        err.status = 400;
        reject(err);
      }
    });
    req.on('error', (e) => {
      if (done) return;
      done = true;
      reject(e);
    });
  });
}

function sendJson(res, status, obj) {
  if (res.headersSent || res.writableEnded) {
    try { res.end(); } catch { /* already gone */ }
    return;
  }
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

// Reads the substrate store's user-applied states map ({relPath: string[]}).
// Tolerant of the store module being absent or returning either the bare map
// or the persisted {states:{...}} envelope. Never throws.
async function readStoreStates(root) {
  let store;
  try { store = require('./store'); } catch { return {}; }
  if (!store || typeof store.getStates !== 'function') return {};
  try {
    const s = await store.getStates(root);
    if (s && typeof s === 'object') {
      if (s.states && typeof s.states === 'object' && !Array.isArray(s.states)) return s.states;
      if (!Array.isArray(s)) return s;
    }
  } catch { /* store unreadable → no stored states */ }
  return {};
}

module.exports = { assertInside, readJsonBody, sendJson, readStoreStates, MIME_TYPES };
