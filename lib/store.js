'use strict';
// Substrate store — persistent state under <root>/.substrate/
// state.json     {states: {[relPath]: string[]}}
// proposals.json {proposals: [{id, kind, created, actions, resolved?, resolution?}]}
// checkpoints/index.json {checkpoints: [{id, label, created, count, bytes}]}
// All writes are atomic (tmp + rename). Directories are created lazily.

const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');

function substrateDir(root) {
  return path.join(root, '.substrate');
}

function stateFile(root) {
  return path.join(substrateDir(root), 'state.json');
}

function proposalsFile(root) {
  return path.join(substrateDir(root), 'proposals.json');
}

function checkpointsIndexFile(root) {
  return path.join(substrateDir(root), 'checkpoints', 'index.json');
}

async function readJson(file, fallback) {
  try {
    return JSON.parse(await fsp.readFile(file, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJsonAtomic(file, data) {
  await fsp.mkdir(path.dirname(file), { recursive: true });
  const tmp = file + '.tmp-' + crypto.randomBytes(4).toString('hex');
  await fsp.writeFile(tmp, JSON.stringify(data, null, 2) + '\n');
  await fsp.rename(tmp, file);
}

// ---- states ----------------------------------------------------------------

async function getStates(root) {
  const data = await readJson(stateFile(root), { states: {} });
  return data && data.states && typeof data.states === 'object' ? data.states : {};
}

async function addState(root, relPath, s) {
  const data = await readJson(stateFile(root), { states: {} });
  if (!data.states || typeof data.states !== 'object') data.states = {};
  const set = new Set(Array.isArray(data.states[relPath]) ? data.states[relPath] : []);
  set.add(s);
  data.states[relPath] = [...set];
  await writeJsonAtomic(stateFile(root), data);
  return data.states[relPath];
}

// ---- proposals -------------------------------------------------------------

async function readAllProposals(root) {
  const data = await readJson(proposalsFile(root), { proposals: [] });
  return Array.isArray(data && data.proposals) ? data.proposals : [];
}

// Open (unresolved) proposals only — what GET /api/proposals returns.
async function listProposals(root) {
  return (await readAllProposals(root)).filter((p) => !p.resolved);
}

async function getProposal(root, id) {
  return (await readAllProposals(root)).find((p) => p.id === id) || null;
}

async function addProposal(root, proposal) {
  const all = await readAllProposals(root);
  all.push(proposal);
  await writeJsonAtomic(proposalsFile(root), { proposals: all });
  return proposal;
}

// Marks the proposal resolved (kept in the file as history). Returns the
// updated proposal, or null if the id is unknown.
async function resolveProposal(root, id, action = 'merge') {
  const all = await readAllProposals(root);
  const p = all.find((x) => x.id === id);
  if (!p) return null;
  p.resolved = Date.now();
  p.resolution = action;
  await writeJsonAtomic(proposalsFile(root), { proposals: all });
  return p;
}

// ---- checkpoints index -----------------------------------------------------

async function listCheckpoints(root) {
  const data = await readJson(checkpointsIndexFile(root), { checkpoints: [] });
  return Array.isArray(data && data.checkpoints) ? data.checkpoints : [];
}

async function addCheckpoint(root, checkpoint) {
  const all = await listCheckpoints(root);
  all.push(checkpoint);
  await writeJsonAtomic(checkpointsIndexFile(root), { checkpoints: all });
  return checkpoint;
}

module.exports = {
  substrateDir,
  writeJsonAtomic,
  getStates,
  addState,
  listProposals,
  getProposal,
  addProposal,
  resolveProposal,
  listCheckpoints,
  addCheckpoint,
  // short aliases per contract §13 ("API: list/get/add/resolve")
  list: listProposals,
  get: getProposal,
  add: addProposal,
  resolve: resolveProposal,
};
