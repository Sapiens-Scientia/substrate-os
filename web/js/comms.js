// Comms boundary layer — the field above the membrane. Contract §12.
import { bus } from './bus.js';
import { state } from './state.js';

const CHANNELS = [
  { id: 'web',      glyph: '⌁', name: 'Web' },
  { id: 'mail',     glyph: '✉', name: 'Mail' },
  { id: 'messages', glyph: '◌', name: 'Messages' },
  { id: 'airdrop',  glyph: '⇄', name: 'AirDrop' },
  { id: 'cloud',    glyph: '☁', name: 'Cloud' },
  { id: 'git',      glyph: '⎇', name: 'Git' },
];
const BY_ID = new Map(CHANNELS.map(c => [c.id, c]));
const SIM_LABEL = 'simulation — channels not connected';
const TRAY_MAX = 6;
const LOG_MAX = 200;

// session boundary-event log
const log = [];            // {t, type:'release'|'proposal'|'message', ...}
const consoles = new Set();// open channel consoles {channel, feedEl, aggEl}
let fsCount = 0;
let trayChips = null;      // container for .artifact-chip
let plaqueName = null;

// ---------- tiny DOM helpers ----------

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text; // data only ever lands here
  return n;
}

function clickable(node, fn) {
  node.setAttribute('role', 'button');
  node.tabIndex = 0;
  node.addEventListener('click', fn);
  node.addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fn(e); }
  });
}

function basename(p) {
  const parts = String(p).split('/').filter(Boolean);
  return parts.length ? parts[parts.length - 1] : String(p);
}

function fmtTime(ms) {
  const d = new Date(ms);
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function bindTip(node, text) {
  const tip = document.getElementById('tooltip');
  if (!tip) { node.title = text; return; }
  node.addEventListener('mouseenter', () => {
    tip.textContent = text;
    const r = node.getBoundingClientRect();
    tip.style.left = Math.round(r.left + r.width / 2) + 'px';
    tip.style.top = Math.round(r.bottom + 8) + 'px';
    tip.classList.remove('hidden');
  });
  node.addEventListener('mouseleave', () => tip.classList.add('hidden'));
}

// ---------- style probing + scoped fallback styles ----------

function probeClass(host, cls) {
  const p = el('div', cls);
  p.style.visibility = 'hidden';
  host.appendChild(p);
  const cs = getComputedStyle(p);
  const styled =
    cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ||
    parseFloat(cs.borderTopLeftRadius) > 0 ||
    parseFloat(cs.borderTopWidth) > 0 ||
    cs.padding !== '0px';
  const after = getComputedStyle(p, '::after').content;
  p.remove();
  return { styled, hasAfterDot: !!after && after !== 'none' && after !== 'normal' };
}

function injectStyles(stripEl) {
  if (document.getElementById('cx-comms-style')) {
    return probeClass(stripEl, 'comm-chip');
  }
  const chip = probeClass(stripEl, 'comm-chip');
  const art = probeClass(stripEl, 'artifact-chip');

  let css = `
#comms-strip{position:relative;}
#comms-strip .cx-root{position:relative;height:100%;display:flex;align-items:center;gap:18px;padding:0 18px 0 16px;box-sizing:border-box;}
#comms-strip .cx-plaque{display:flex;align-items:center;gap:11px;flex:none;}
#comms-strip .cx-plaque-glyph{font-size:17px;line-height:1;color:var(--accent);opacity:.75;text-shadow:0 0 10px rgba(76,201,240,.35);}
#comms-strip .cx-plaque-col{display:flex;flex-direction:column;gap:3px;}
#comms-strip .cx-plaque-name{font:600 13px/1 var(--font);color:var(--ink);letter-spacing:.02em;}
#comms-strip .cx-plaque-cap{font:400 10px/1 var(--font);color:var(--ink-dim);letter-spacing:.05em;}
#comms-strip .cx-channels{flex:1;display:flex;align-items:center;justify-content:center;gap:10px;min-width:0;flex-wrap:wrap;}
#comms-strip .cx-tray{flex:none;display:flex;align-items:center;gap:8px;max-width:34%;justify-content:flex-end;}
#comms-strip .cx-tray-label{font:600 8px/1 var(--font);letter-spacing:.18em;color:var(--ink-dim);opacity:.55;flex:none;writing-mode:vertical-rl;transform:rotate(180deg);}
#comms-strip .cx-tray-chips{display:flex;align-items:center;gap:7px;overflow:hidden;}
#comms-strip .cx-dot{width:4px;height:4px;border-radius:50%;background:var(--accent);opacity:.12;flex:none;animation:cx-blink 7s ease-in-out infinite;}
#comms-strip .cx-membrane{position:absolute;left:0;right:0;bottom:0;height:1px;background:var(--accent);opacity:.8;box-shadow:0 0 8px rgba(76,201,240,.55),0 -2px 10px rgba(76,201,240,.18);overflow:visible;pointer-events:none;z-index:3;}
#comms-strip .cx-membrane-glow{position:absolute;top:-3px;bottom:-3px;width:22%;left:-25%;background:linear-gradient(90deg,transparent,rgba(76,201,240,.5),transparent);animation:cx-shimmer 8s linear infinite;}
#comms-strip .cx-achip-dot{width:5px;height:5px;border-radius:50%;background:var(--gold);box-shadow:0 0 6px rgba(240,179,94,.7);flex:none;}
#comms-strip .cx-alabel{max-width:96px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
#comms-strip .cx-drop{animation:cx-drop .55s cubic-bezier(.22,1.4,.36,1);}
#comms-strip .cx-gone{opacity:0 !important;transform:translateX(10px);transition:opacity .4s ease,transform .4s ease;}
@keyframes cx-blink{0%,84%,100%{opacity:.12;box-shadow:none;}89%{opacity:.95;box-shadow:0 0 6px var(--accent);}94%{opacity:.3;}}
@keyframes cx-shimmer{to{left:103%;}}
@keyframes cx-drop{0%{transform:translateY(-30px);opacity:0;}60%{transform:translateY(3px);opacity:1;}100%{transform:translateY(0);opacity:1;}}
@keyframes cx-shake{0%,100%{transform:translateX(0);}25%{transform:translateX(-4px);}50%{transform:translateX(4px);}75%{transform:translateX(-2px);}}
.cx-console{display:flex;flex-direction:column;height:100%;min-height:0;gap:10px;font:400 12px/1.45 var(--font);color:var(--ink);}
.cx-console *{box-sizing:border-box;}
.cx-console .cx-head{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;}
.cx-console .cx-chan{display:flex;align-items:baseline;gap:8px;color:var(--ink);}
.cx-console .cx-chan-glyph{color:var(--accent);font-size:14px;}
.cx-console .cx-chan-name{font-weight:600;letter-spacing:.03em;}
.cx-console .cx-chan-sub{font:400 10px var(--font);color:var(--ink-dim);letter-spacing:.05em;}
.cx-console .cx-sim{padding:4px 10px;border:1px dashed rgba(240,179,94,.5);border-radius:6px;color:var(--gold);font:500 10px/1 var(--mono);letter-spacing:.07em;background:rgba(240,179,94,.05);white-space:nowrap;}
.cx-console .cx-agg{font:400 10px/1 var(--mono);color:var(--ink-dim);letter-spacing:.04em;padding-left:2px;}
.cx-console .cx-feed{flex:1;min-height:90px;overflow-y:auto;display:flex;flex-direction:column;gap:7px;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:rgba(12,16,24,.55);}
.cx-console .cx-entry{display:flex;gap:9px;align-items:baseline;}
.cx-console .cx-time{font:400 9.5px var(--mono);color:var(--ink-dim);opacity:.7;flex:none;}
.cx-console .cx-eglyph{flex:none;width:15px;text-align:center;font-size:11px;}
.cx-console .cx-t-release .cx-eglyph{color:var(--gold);}
.cx-console .cx-t-proposal .cx-eglyph{color:var(--green);}
.cx-console .cx-t-proposal.cx-neg .cx-eglyph{color:var(--ink-dim);}
.cx-console .cx-t-message .cx-eglyph{color:var(--accent);}
.cx-console .cx-etext{color:var(--ink);opacity:.92;overflow-wrap:anywhere;min-width:0;}
.cx-console .cx-emeta{font:400 9.5px var(--mono);color:var(--ink-dim);flex:none;}
.cx-console .cx-empty{font:400 11px var(--font);color:var(--ink-dim);opacity:.6;margin:auto;letter-spacing:.04em;}
.cx-console .cx-compose{display:flex;flex-direction:column;gap:8px;}
.cx-console .cx-pills{display:flex;gap:6px;flex-wrap:wrap;}
.cx-console .cx-pills.cx-shaking{animation:cx-shake .4s ease;}
.cx-console .cx-pill{padding:4px 11px;border-radius:999px;border:1px solid var(--line);color:var(--ink-dim);font:500 10.5px/1.3 var(--font);cursor:pointer;user-select:none;background:transparent;transition:color .15s,border-color .15s,background .15s;}
.cx-console .cx-pill:hover{color:var(--ink);}
.cx-console .cx-pill.on{border-color:var(--accent);color:var(--accent);background:rgba(76,201,240,.09);}
.cx-console .cx-input-row{display:flex;gap:8px;}
.cx-console .cx-input{flex:1;min-width:0;background:rgba(12,16,24,.6);border:1px solid var(--line);border-radius:7px;color:var(--ink);font:400 12px var(--font);padding:8px 11px;outline:none;transition:border-color .15s;}
.cx-console .cx-input::placeholder{color:var(--ink-dim);opacity:.6;}
.cx-console .cx-input:focus{border-color:var(--accent);}
.cx-console .cx-send{flex:none;padding:8px 18px;border:1px solid rgba(76,201,240,.55);border-radius:7px;background:rgba(76,201,240,.1);color:var(--accent);font:600 11px/1 var(--font);letter-spacing:.06em;cursor:pointer;transition:background .15s,box-shadow .2s;}
.cx-console .cx-send:hover{background:rgba(76,201,240,.18);box-shadow:0 0 12px rgba(76,201,240,.18);}
.cx-console .cx-send:active{transform:translateY(1px);}
`;

  if (!chip.styled) {
    css += `
#comms-strip .comm-chip{display:flex;align-items:center;gap:7px;padding:8px 14px;border:1px solid var(--line);border-radius:999px;background:rgba(19,26,38,.55);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:var(--ink-dim);font:500 11.5px/1 var(--font);letter-spacing:.03em;cursor:pointer;user-select:none;box-shadow:0 0 12px rgba(76,201,240,.04);transition:color .2s,border-color .2s,box-shadow .25s;}
#comms-strip .comm-chip:hover,#comms-strip .comm-chip:focus-visible{color:var(--ink);border-color:rgba(76,201,240,.6);box-shadow:0 0 16px rgba(76,201,240,.14);outline:none;}
#comms-strip .comm-chip .cx-chip-glyph{font-size:13px;line-height:1;opacity:.85;}
`;
  }
  if (!art.styled) {
    css += `
#comms-strip .artifact-chip{display:flex;align-items:center;gap:6px;padding:5px 11px;border:1px solid rgba(240,179,94,.35);border-radius:999px;background:rgba(240,179,94,.07);color:var(--ink-dim);font:400 10.5px/1.2 var(--mono);flex:none;transition:opacity .4s ease;}
`;
  }

  const tag = el('style');
  tag.id = 'cx-comms-style';
  tag.textContent = css;
  document.head.appendChild(tag);
  return chip;
}

// ---------- session log + console broadcast ----------

function entryMatches(entry, channelId) {
  return entry.type !== 'message' || entry.channels.includes(channelId);
}

function aggText() {
  return `boundary watch · ${fsCount} filesystem change${fsCount === 1 ? '' : 's'} this session`;
}

function entryRow(entry) {
  let glyph = '·', cls = 'cx-entry', text = '', meta = '';
  if (entry.type === 'release') {
    glyph = '↥';
    cls += ' cx-t-release';
    const names = entry.names.slice(0, 3).join(', ');
    text = 'released through membrane · ' + names +
      (entry.names.length > 3 ? ` +${entry.names.length - 3} more` : '');
  } else if (entry.type === 'proposal') {
    glyph = entry.verb === 'merged' ? '✓' : '✕';
    cls += ' cx-t-proposal' + (entry.verb === 'merged' ? '' : ' cx-neg');
    text = `proposal ${entry.id} ${entry.verb}`;
  } else if (entry.type === 'message') {
    glyph = '⇢';
    cls += ' cx-t-message';
    text = entry.text;
    meta = '→ ' + entry.channels.map(id => (BY_ID.get(id) || { name: id }).name).join(', ') + ' · sim';
  }
  const row = el('div', cls);
  row.appendChild(el('span', 'cx-time', fmtTime(entry.t)));
  row.appendChild(el('span', 'cx-eglyph', glyph));
  row.appendChild(el('span', 'cx-etext', text));
  if (meta) row.appendChild(el('span', 'cx-emeta', meta));
  return row;
}

function appendEntry(feedEl, entry) {
  const empty = feedEl.querySelector('.cx-empty');
  if (empty) empty.remove();
  feedEl.appendChild(entryRow(entry));
  feedEl.scrollTop = feedEl.scrollHeight;
}

function pushEntry(entry) {
  log.push(entry);
  if (log.length > LOG_MAX) log.splice(0, log.length - LOG_MAX);
  for (const c of consoles) {
    if (!c.feedEl.isConnected) { consoles.delete(c); continue; }
    if (entryMatches(entry, c.channel)) appendEntry(c.feedEl, entry);
  }
}

function refreshAgg() {
  for (const c of consoles) {
    if (!c.aggEl.isConnected) { consoles.delete(c); continue; }
    c.aggEl.textContent = aggText();
  }
}

// ---------- outbound artifact tray ----------

function restyleTray() {
  const chips = Array.from(trayChips.children).filter(n => !n.classList.contains('cx-gone'));
  chips.forEach((c, i) => { c.style.opacity = String(Math.max(0.4, 1 - i * 0.11)); });
}

function dockChip(label, tip) {
  if (!trayChips) return;
  const chip = el('div', 'artifact-chip cx-drop');
  chip.appendChild(el('span', 'cx-achip-dot'));
  chip.appendChild(el('span', 'cx-alabel', label));
  bindTip(chip, tip);
  trayChips.prepend(chip);
  chip.addEventListener('animationend', () => chip.classList.remove('cx-drop'), { once: true });
  const live = Array.from(trayChips.children).filter(n => !n.classList.contains('cx-gone'));
  for (const old of live.slice(TRAY_MAX)) {
    old.classList.add('cx-gone');
    setTimeout(() => old.remove(), 450);
  }
  restyleTray();
}

// ---------- channel console window ----------

function buildConsole(contentEl, ch) {
  const root = el('div', 'cx-console');

  const head = el('div', 'cx-head');
  const chan = el('div', 'cx-chan');
  chan.appendChild(el('span', 'cx-chan-glyph', ch.glyph));
  chan.appendChild(el('span', 'cx-chan-name', ch.name));
  chan.appendChild(el('span', 'cx-chan-sub', 'boundary feed'));
  head.appendChild(chan);
  head.appendChild(el('span', 'cx-sim', SIM_LABEL));
  root.appendChild(head);

  const agg = el('div', 'cx-agg', aggText());
  root.appendChild(agg);

  const feed = el('div', 'cx-feed');
  const seen = log.filter(e => entryMatches(e, ch.id)).slice(-60);
  if (seen.length === 0) {
    feed.appendChild(el('div', 'cx-empty', 'quiet field — no boundary events yet'));
  } else {
    for (const e of seen) feed.appendChild(entryRow(e));
  }
  root.appendChild(feed);

  const compose = el('div', 'cx-compose');
  const pillsRow = el('div', 'cx-pills');
  const pills = CHANNELS.map(c => {
    const p = el('div', 'cx-pill' + (c.id === ch.id ? ' on' : ''), c.glyph + ' ' + c.name);
    p.dataset.ch = c.id;
    clickable(p, () => p.classList.toggle('on'));
    return p;
  });
  for (const p of pills) pillsRow.appendChild(p);
  compose.appendChild(pillsRow);

  const inputRow = el('div', 'cx-input-row');
  const input = el('input', 'cx-input');
  input.type = 'text';
  input.placeholder = 'compose dispatch — goes to every toggled channel…';
  const send = el('button', 'cx-send', 'Send');
  send.type = 'button';
  inputRow.appendChild(input);
  inputRow.appendChild(send);
  compose.appendChild(inputRow);
  root.appendChild(compose);

  const doSend = () => {
    const text = input.value.trim();
    if (!text) { input.focus(); return; }
    const chans = pills.filter(p => p.classList.contains('on')).map(p => p.dataset.ch);
    if (chans.length === 0) {
      pillsRow.classList.add('cx-shaking');
      setTimeout(() => pillsRow.classList.remove('cx-shaking'), 450);
      return;
    }
    pushEntry({ t: Date.now(), type: 'message', text, channels: chans });
    dockChip(text, 'dispatched · ' + SIM_LABEL);
    input.value = '';
    input.focus();
  };
  send.addEventListener('click', doSend);
  input.addEventListener('keydown', e => { if (e.key === 'Enter') doSend(); });

  contentEl.appendChild(root);
  consoles.add({ channel: ch.id, feedEl: feed, aggEl: agg });
  feed.scrollTop = feed.scrollHeight;
}

function openConsole(ch) {
  bus.emit('window:open', {
    title: ch.glyph + ' ' + ch.name + ' · channel console',
    kind: 'comms',
    w: 640,
    h: 480,
    render(contentEl) { buildConsole(contentEl, ch); },
  });
}

// ---------- strip construction ----------

export function initComms(stripEl) {
  const chipProbe = injectStyles(stripEl);

  const root = el('div', 'cx-root');

  // left: domain plaque
  const plaque = el('div', 'cx-plaque');
  plaque.appendChild(el('span', 'cx-plaque-glyph', '▣'));
  const col = el('div', 'cx-plaque-col');
  plaqueName = el('span', 'cx-plaque-name', state.root ? basename(state.root) : 'substrate');
  col.appendChild(plaqueName);
  col.appendChild(el('span', 'cx-plaque-cap', 'local domain · 3 walls sealed · membrane active'));
  plaque.appendChild(col);
  root.appendChild(plaque);

  // center: channel chips
  const channels = el('div', 'cx-channels');
  CHANNELS.forEach((ch, i) => {
    const chip = el('div', 'comm-chip');
    chip.dataset.channel = ch.id;
    chip.appendChild(el('span', 'cx-chip-glyph', ch.glyph));
    chip.appendChild(el('span', 'cx-chip-name', ch.name));
    if (!chipProbe.hasAfterDot) {
      const dot = el('span', 'cx-dot');
      dot.style.animationDelay = (i * 1.13).toFixed(2) + 's';
      dot.style.animationDuration = (6 + i * 0.7).toFixed(2) + 's';
      chip.appendChild(dot);
    }
    clickable(chip, () => openConsole(ch));
    channels.appendChild(chip);
  });
  root.appendChild(channels);

  // right: outbound artifact tray
  const tray = el('div', 'cx-tray');
  tray.appendChild(el('span', 'cx-tray-label', 'OUTBOUND'));
  trayChips = el('div', 'cx-tray-chips');
  tray.appendChild(trayChips);
  root.appendChild(tray);

  stripEl.appendChild(root);

  // membrane upper surface along the strip's bottom edge
  const membrane = el('div', 'cx-membrane');
  membrane.appendChild(el('div', 'cx-membrane-glow'));
  stripEl.appendChild(membrane);

  // ---------- bus wiring ----------

  bus.on('release:landed', payload => {
    const paths = (payload && payload.paths) || [];
    if (paths.length === 0) return;
    const names = paths.map(basename);
    pushEntry({ t: Date.now(), type: 'release', names });
    names.slice(0, TRAY_MAX).forEach((name, i) => {
      setTimeout(() => dockChip(name, 'released from local domain'), i * 90);
    });
  });

  bus.on('proposal:resolved', payload => {
    const action = String((payload && payload.action) || '');
    const verb = action.startsWith('merge') ? 'merged'
      : action.startsWith('discard') ? 'discarded' : (action || 'resolved');
    pushEntry({ t: Date.now(), type: 'proposal', id: String((payload && payload.id) || '?'), verb });
  });

  bus.on('fs:changed', () => {
    fsCount += 1;
    refreshAgg();
  });

  bus.on('tree:updated', () => {
    if (state.root) plaqueName.textContent = basename(state.root);
  });
}
