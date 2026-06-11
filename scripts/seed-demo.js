'use strict';
// Demo substrate seeder — deterministic and idempotent (wipe + recreate).
// Usage: node scripts/seed-demo.js [dir]   (default <repo>/demo-substrate)
// Also: const { seed } = require('./scripts/seed-demo'); await seed(dir);

const fsp = require('node:fs/promises');
const path = require('node:path');

// ---- deterministic bytes ---------------------------------------------------

function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(str) {
  let s = 2166136261;
  for (let i = 0; i < str.length; i++) {
    s ^= str.charCodeAt(i);
    s = Math.imul(s, 16777619);
  }
  return s >>> 0;
}

// Pseudo-random but fully deterministic binary blob, optional magic prefix.
function blob(key, size, magic) {
  const head = magic ? Buffer.from(magic, 'latin1') : Buffer.alloc(0);
  const body = Buffer.allocUnsafe(Math.max(0, size - head.length));
  const rnd = mulberry32(seedFrom(key));
  let i = 0;
  for (; i + 4 <= body.length; i += 4) {
    body.writeUInt32LE((rnd() * 4294967296) >>> 0, i);
  }
  for (; i < body.length; i++) body[i] = (rnd() * 256) | 0;
  return Buffer.concat([head, body]);
}

const PDF_MAGIC = '%PDF-1.4\n';
const ZIP_MAGIC = 'PK\x03\x04';
const PNG_MAGIC = '\x89PNG\r\n\x1a\n';
const HEIC_MAGIC = '\x00\x00\x00\x18ftypheic';
const MOV_MAGIC = '\x00\x00\x00\x14ftypqt  ';
const M4A_MAGIC = '\x00\x00\x00\x18ftypM4A ';

// ---- text content ----------------------------------------------------------

const AURORA_README = `# aurora-app

A small canvas toy: slow aurora ribbons over a dark field.

- zero dependencies
- run: open index from any static server
- src/ holds the render loop, state, and helpers
`;

const AURORA_PKG = `{
  "name": "aurora-app",
  "private": true,
  "version": "0.3.1",
  "description": "slow aurora ribbons on canvas"
}
`;

const AURORA_INDEX = `import { createState } from './state.js';
import { render } from './render.js';

const canvas = document.querySelector('canvas');
const state = createState(canvas);

function frame(t) {
  render(state, t);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
`;

const AURORA_RENDER = `import { lerp, band } from './util.js';

export function render(state, t) {
  const { ctx, w, h, ribbons } = state;
  ctx.fillStyle = '#05070c';
  ctx.fillRect(0, 0, w, h);
  for (const r of ribbons) {
    ctx.beginPath();
    for (let x = 0; x <= w; x += 8) {
      const y = band(x, t * r.speed, r.phase) * r.amp + r.base * h;
      x === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.strokeStyle = r.color;
    ctx.globalAlpha = lerp(0.08, 0.22, Math.sin(t / 4000 + r.phase) * 0.5 + 0.5);
    ctx.lineWidth = r.width;
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}
`;

const AURORA_STATE = `export function createState(canvas) {
  const ctx = canvas.getContext('2d');
  const w = (canvas.width = canvas.clientWidth);
  const h = (canvas.height = canvas.clientHeight);
  const ribbons = [];
  for (let i = 0; i < 5; i++) {
    ribbons.push({
      base: 0.2 + i * 0.14,
      amp: 26 + i * 9,
      width: 38 - i * 5,
      speed: 0.00009 * (i + 1),
      phase: i * 1.7,
      color: ['#3de8c9', '#4cc9f0', '#a78bfa', '#69c98f', '#5e9bf0'][i],
    });
  }
  return { ctx, w, h, ribbons };
}
`;

const AURORA_UTIL = `export const lerp = (a, b, t) => a + (b - a) * t;

export function band(x, t, phase) {
  return (
    Math.sin(x * 0.004 + t + phase) * 0.6 +
    Math.sin(x * 0.011 - t * 1.7 + phase * 2) * 0.4
  );
}
`;

const AURORA_LOGO = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="12" fill="#0a0f18"/>
  <path d="M8 44 C 20 20, 28 52, 40 28 S 56 36, 56 20" fill="none"
        stroke="#4cc9f0" stroke-width="3" stroke-linecap="round" opacity=".85"/>
  <path d="M8 52 C 22 34, 30 58, 44 40 S 56 46, 56 34" fill="none"
        stroke="#a78bfa" stroke-width="2" stroke-linecap="round" opacity=".6"/>
</svg>
`;

const AURORA_NOTES = `# notes

- ribbons drift too fast on 120Hz — scale speed by dt, not frame count
- try additive blend ('lighter') for crossings
- idea: pin a ribbon to live mic input level
`;

const OLDSITE_INDEX = `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <title>ben — portfolio</title>
  <link rel="stylesheet" href="styles.css">
</head>
<body>
  <header><h1>ben</h1><p>things I made, 2019–2021</p></header>
  <main id="grid"></main>
  <script src="main.js"></script>
</body>
</html>
`;

const OLDSITE_CSS = `body {
  margin: 0;
  background: #111;
  color: #ddd;
  font: 16px/1.5 Georgia, serif;
}
header { padding: 4rem 2rem 2rem; }
#grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 1rem;
  padding: 2rem;
}
.card { background: #1a1a1a; padding: 1rem; border-radius: 4px; }
`;

const OLDSITE_JS = `var projects = [
  { name: 'tidepool', year: 2019 },
  { name: 'paper crane generator', year: 2020 },
  { name: 'slow clock', year: 2021 },
];
var grid = document.getElementById('grid');
projects.forEach(function (p) {
  var el = document.createElement('div');
  el.className = 'card';
  el.textContent = p.name + ' (' + p.year + ')';
  grid.appendChild(el);
});
`;

const OLDSITE_GALLERY = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>gallery</title></head>
<body>
  <p>gallery moved — see main page.</p>
</body>
</html>
`;

const MEETING_NOTES = `MEETING NOTES — substrate sync (v3, FINAL)

attendees: B, K, dl
decisions:
  * membrane stays at the top. walls do not open. ever.
  * effectors propose; the human merges. no silent writes.
  * release = state change + ascent animation, nothing leaves the machine.
open:
  - checkpoint retention policy?
  - who owns the comms strip copy
`;

const GROCERY = `pierogi flour (00 if they have it)
farmer cheese x2
butter
dill — a lot
sour cream
yellow onions x3
black tea
`;

const TODO_COPY = `[ ] empty Inbox drop into real folders
[ ] dedupe Media/export against raw
[x] seed demo substrate
[ ] rename pass on Documents (so messy)
[ ] checkpoint aurora-app before refactor
`;

const DATA_EXPORT = `id,name,kind,bytes,modified
1,aurora-app,project,18432,2026-03-02
2,old-site,project,9216,2022-03-14
3,Final Report,document,184320,2026-01-20
4,clip_render_v2,video,1258291,2026-02-11
5,IMG_2041,photo,1126400,2026-04-03
`;

const UNTITLED_NOTE = `things the demo must show
- marble block, carved from the top
- three sealed walls, one shimmering membrane
- gold particles rising on release
(this note is itself a candidate for the rename effector)
`;

// ---- manifest --------------------------------------------------------------
// [relPath, content]  — Buffers for binary, strings for text.

function buildManifest() {
  // duplicate pairs share one buffer source key → identical bytes
  const img2041 = blob('media/IMG_2041', 1126400, HEIC_MAGIC);
  const clip = blob('media/clip_render_v2', 1258291, MOV_MAGIC);

  return [
    // Projects/aurora-app — small healthy code tree
    ['Projects/aurora-app/README.md', AURORA_README],
    ['Projects/aurora-app/package.json', AURORA_PKG],
    ['Projects/aurora-app/src/index.js', AURORA_INDEX],
    ['Projects/aurora-app/src/render.js', AURORA_RENDER],
    ['Projects/aurora-app/src/state.js', AURORA_STATE],
    ['Projects/aurora-app/src/util.js', AURORA_UTIL],
    ['Projects/aurora-app/assets/logo.svg', AURORA_LOGO],
    ['Projects/aurora-app/docs/notes.md', AURORA_NOTES],

    // Projects/old-site — stale (utimes forced to 2022 below)
    ['Projects/old-site/index.html', OLDSITE_INDEX],
    ['Projects/old-site/styles.css', OLDSITE_CSS],
    ['Projects/old-site/main.js', OLDSITE_JS],
    ['Projects/old-site/gallery.html', OLDSITE_GALLERY],

    // Documents — messy names for the rename effector
    ['Documents/Final Report  copy 2.PDF', blob('docs/final-report', 184320, PDF_MAGIC)],
    ['Documents/meeting notes_v3 FINAL.txt', MEETING_NOTES],
    ['Documents/Budget_2024 copy.xlsx', blob('docs/budget-2024', 38912, ZIP_MAGIC)],
    ['Documents/resume OLD copy.docx', blob('docs/resume-old', 24576, ZIP_MAGIC)],
    ["Documents/grandma's pierogi.txt", GROCERY],

    // Media — duplicates across raw/ and export/
    ['Media/raw/IMG_2041.heic', img2041],
    ['Media/raw/IMG_2044.heic', blob('media/IMG_2044', 716800, HEIC_MAGIC)],
    ['Media/raw/clip_render_v2.mov', clip],
    ['Media/raw/voice memo 14.m4a', blob('media/voice-memo-14', 512000, M4A_MAGIC)],
    ['Media/export/IMG_2041 copy.heic', img2041],
    ['Media/export/clip_render_v2.mov', clip],
    ['Media/export/cover_art_final.png', blob('media/cover-art', 153600, PNG_MAGIC)],

    // Downloads — installer-ish
    ['Downloads/Substrate-Installer-v3.2.1.dmg', blob('dl/installer', 921600, ZIP_MAGIC)],
    ['Downloads/archive-backup-2023.zip', blob('dl/archive-backup', 307200, ZIP_MAGIC)],
    ['Downloads/font-pack (1).zip', blob('dl/font-pack', 204800, ZIP_MAGIC)],
    ['Downloads/manual_v2.pdf', blob('dl/manual', 262144, PDF_MAGIC)],

    // Inbox drop — loose ends
    ['Inbox drop/TODO  copy.txt', TODO_COPY],
    ['Inbox drop/screenshot 2024-11-02 at 9.41 AM.png', blob('inbox/screenshot', 122880, PNG_MAGIC)],
    ['Inbox drop/data export.csv', DATA_EXPORT],
    ['Inbox drop/untitled note_v2 FINAL.txt', UNTITLED_NOTE],
  ];
}

// Deterministic timestamps (UTC). old-site = 2022 → stale effector fodder.
const TOUCH = [
  ['Projects/old-site/index.html', '2022-03-14T10:00:00Z'],
  ['Projects/old-site/styles.css', '2022-03-14T10:01:00Z'],
  ['Projects/old-site/main.js', '2022-04-02T16:20:00Z'],
  ['Projects/old-site/gallery.html', '2022-02-01T09:00:00Z'],
  ['Projects/old-site', '2022-04-02T16:20:00Z'],
  ['Downloads/archive-backup-2023.zip', '2023-08-19T12:00:00Z'],
  ['Documents/resume OLD copy.docx', '2023-05-06T08:30:00Z'],
  ['Projects/aurora-app/README.md', '2026-03-02T11:00:00Z'],
  ['Projects/aurora-app/src/index.js', '2026-05-28T18:40:00Z'],
  ['Projects/aurora-app/src/render.js', '2026-05-28T18:42:00Z'],
  ['Projects/aurora-app/docs/notes.md', '2026-06-01T07:55:00Z'],
  ['Documents/Final Report  copy 2.PDF', '2026-01-20T15:10:00Z'],
  ['Documents/meeting notes_v3 FINAL.txt', '2026-05-12T09:05:00Z'],
  ['Documents/Budget_2024 copy.xlsx', '2026-02-14T13:00:00Z'],
  ['Media/raw/IMG_2041.heic', '2026-04-03T17:22:00Z'],
  ['Media/raw/IMG_2044.heic', '2026-04-03T17:24:00Z'],
  ['Media/raw/clip_render_v2.mov', '2026-02-11T20:15:00Z'],
  ['Media/raw/voice memo 14.m4a', '2026-03-19T08:12:00Z'],
  ['Media/export/IMG_2041 copy.heic', '2026-04-05T10:00:00Z'],
  ['Media/export/clip_render_v2.mov', '2026-02-12T07:45:00Z'],
  ['Media/export/cover_art_final.png', '2026-04-30T19:30:00Z'],
  ['Downloads/Substrate-Installer-v3.2.1.dmg', '2026-04-22T21:05:00Z'],
  ['Downloads/font-pack (1).zip', '2026-03-30T14:18:00Z'],
  ['Downloads/manual_v2.pdf', '2026-04-22T21:08:00Z'],
  ['Inbox drop/TODO  copy.txt', '2026-05-30T22:10:00Z'],
  ['Inbox drop/screenshot 2024-11-02 at 9.41 AM.png', '2026-05-02T09:41:00Z'],
  ['Inbox drop/data export.csv', '2026-05-19T16:33:00Z'],
  ['Inbox drop/untitled note_v2 FINAL.txt', '2026-06-03T23:59:00Z'],
];

// Seeded boundary states — one of each headline state.
const SEED_STATES = {
  'Documents/meeting notes_v3 FINAL.txt': ['synced'],
  'Media/export': ['shared'],
  'Documents/Final Report  copy 2.PDF': ['published'],
  'Projects/aurora-app': ['agent-accessible'],
};

// ---- seed ------------------------------------------------------------------

async function seed(dir) {
  const root = path.resolve(dir);
  await fsp.rm(root, { recursive: true, force: true });
  await fsp.mkdir(root, { recursive: true });

  const manifest = buildManifest();
  let bytes = 0;
  const dirsMade = new Set([root]);

  for (const [rel, content] of manifest) {
    const abs = path.join(root, rel);
    const parent = path.dirname(abs);
    if (!dirsMade.has(parent)) {
      await fsp.mkdir(parent, { recursive: true });
      let d = parent;
      while (!dirsMade.has(d) && d.startsWith(root)) {
        dirsMade.add(d);
        d = path.dirname(d);
      }
    }
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    await fsp.writeFile(abs, buf);
    bytes += buf.length;
  }

  // timestamps: files first, then directories (writes bump parent dir mtimes)
  const touches = TOUCH.map(([rel, iso]) => [rel, new Date(iso)]);
  for (const [rel, date] of touches) {
    const abs = path.join(root, rel);
    const st = await fsp.lstat(abs).catch(() => null);
    if (st && st.isFile()) await fsp.utimes(abs, date, date);
  }
  for (const [rel, date] of touches) {
    const abs = path.join(root, rel);
    const st = await fsp.lstat(abs).catch(() => null);
    if (st && st.isDirectory()) await fsp.utimes(abs, date, date);
  }

  await fsp.mkdir(path.join(root, '.substrate'), { recursive: true });
  await fsp.writeFile(
    path.join(root, '.substrate', 'state.json'),
    JSON.stringify({ states: SEED_STATES }, null, 2) + '\n'
  );

  const entries = manifest.length + (dirsMade.size - 1);
  return { root, entries, bytes };
}

module.exports = { seed };

if (require.main === module) {
  const dir = process.argv[2] || path.join(__dirname, '..', 'demo-substrate');
  seed(dir)
    .then(({ root, entries, bytes }) => {
      console.log(`seeded ${root} — ${entries} entries, ${(bytes / 1048576).toFixed(1)} MB`);
    })
    .catch((err) => {
      console.error('seed failed:', err.message);
      process.exit(1);
    });
}
