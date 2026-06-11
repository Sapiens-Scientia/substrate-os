// Substrate OS — HTTP API client (contract §14).
// All functions throw Error(json.error || status) on non-2xx.
// Per the event table (§6) the api module is the emitter of subtree:updated,
// meta:updated and fs:changed.

import { bus } from './bus.js';

async function request(method, url, body) {
  // X-Substrate forces a CORS preflight on cross-origin requests, which the
  // server never grants — blocks CSRF against the loopback API.
  const opts = { method, headers: { 'X-Substrate': '1' } };
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(url, opts);
  let json = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }
  if (!res.ok) {
    throw new Error((json && json.error) || String(res.status));
  }
  return json;
}

export function getRoot() {
  return request('GET', '/api/root');
}

export function setRoot(path) {
  return request('POST', '/api/root', { path });
}

export function getDisk() {
  return request('GET', '/api/disk');
}

export async function getTree(path) {
  const url = path ? `/api/tree?path=${encodeURIComponent(path)}` : '/api/tree';
  const node = await request('GET', url);
  if (path) bus.emit('subtree:updated', { path, node });
  return node;
}

export async function getMeta(paths) {
  const json = await request('POST', '/api/meta', { paths });
  if (json && json.metas) bus.emit('meta:updated', { metas: json.metas });
  return json;
}

export function runEffector(name, body) {
  return request('POST', `/api/effector/${encodeURIComponent(name)}`, body || {});
}

export function checkpoint(paths, label) {
  const body = label === undefined ? { paths } : { paths, label };
  return request('POST', '/api/checkpoint', body);
}

export function getCheckpoints() {
  return request('GET', '/api/checkpoints');
}

export function getProposals() {
  return request('GET', '/api/proposals');
}

export function mergeProposal(id) {
  return request('POST', `/api/proposal/${encodeURIComponent(id)}/merge`);
}

export function discardProposal(id) {
  return request('POST', `/api/proposal/${encodeURIComponent(id)}/discard`);
}

// --- installed apps as effectors (v2 §16.2) --------------------------------

export function getApps() {
  return request('GET', '/api/apps');
}

export function openWith(app, paths) {
  return request('POST', '/api/open-with', { app, paths: paths || [] });
}

export function reveal(paths) {
  return request('POST', '/api/reveal', { paths: paths || [] });
}

// --- SSE -------------------------------------------------------------------

let es = null;
let reconnectTimer = null;

export function connectEvents() {
  if (es) {
    es.close();
    es = null;
  }
  if (reconnectTimer) {
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }
  es = new EventSource('/api/events');
  es.addEventListener('change', (e) => {
    try {
      const { path, kind } = JSON.parse(e.data);
      bus.emit('fs:changed', { path, kind });
    } catch (err) {
      console.error('api: bad SSE payload', err);
    }
  });
  es.onerror = () => {
    if (es) {
      es.close();
      es = null;
    }
    if (!reconnectTimer) {
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        connectEvents();
      }, 3000);
    }
  };
}
