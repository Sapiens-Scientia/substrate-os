# Substrate OS — MVP Architecture Contract

This document is the **binding contract** for all modules. Every builder implements
exactly the interfaces defined here. If you deviate, you break someone else's module.
Read the whole document before writing code.

## 1. Product concept (what we are building)

Substrate OS is a macOS-native *visual operating layer* prototype, delivered as a
zero-dependency local web app: a pure-Node backend (`server.js`) that scans/watches a
real folder, plus a vanilla-JS frontend rendered mostly on `<canvas>`.

### The quarry metaphor
The machine's storage is a solid block of **marble** (dark, faintly stratified).
The file tree is an **excavation carved downward from the top**: the root is a shaft
at the top of the block, directories are galleries carved deeper, files are chambers
whose visual area is proportional to their byte size. Uncarved marble = free space —
"empty bits are still bits."

### Walls and membrane
The block has **three impenetrable walls** — left, right, bottom — drawn as hard,
solid edges. The **top edge is a selectively permeable membrane** (animated shimmer).
Anything leaving the local domain (upload, publish, share, message) is **pulled UP
through the membrane** into the comms/web field above. Nothing crosses the other walls,
ever.

### Spatial layout (fixed)
- **Top strip**: the Comms/Web boundary layer (above the membrane). Communication
  channels live here. This is OUTSIDE the local block.
- **Left panel**: Effector tools (apps that act on the substrate).
- **Main stage** (right of panel, below strip): the marble block. The tree digs
  downward and grows rightward with nothing in the way.
- **Workspace layer**: an infinite zoomable canvas that overlays the main stage.
  App windows open here. "Fullscreening" a window = zooming the canvas until that
  window fills the stage. The user flips between Filespace and Workspace instantly
  (Tab key or the layer toggle).

### Sovereignty rules
- Every mutating action is a **proposal**: previewed, then explicitly merged or
  discarded. Effectors never silently write.
- Boundary states are first-class and visible: `local`(default), `synced`,
  `downloaded`, `shared`, `published`, `agent-accessible`, `checkpointed`.
- The server binds to 127.0.0.1 only and refuses any path outside the chosen root.
- Nothing is actually uploaded anywhere. "Release" changes state + animates; channels
  are visualized consoles, clearly labeled as not connected to real accounts.

## 2. Tech constraints (hard rules)

- Node >= 18 (dev machine runs Node 24). **Zero npm dependencies.** Only `node:` core
  modules. No TypeScript, no bundler, no build step.
- Frontend: vanilla ES modules (`<script type="module">`), Canvas 2D for the
  Filespace, plain DOM for Workspace windows / panel / comms strip.
- All filenames and user data rendered into DOM must use `textContent` (never
  `innerHTML` with untrusted strings). Canvas text is safe.
- Spawn external binaries only via `execFile` (never `exec` / shell strings), only
  these: `/usr/bin/xattr`, `/usr/bin/df`, `git`, and (per Addendum §16.2)
  `/usr/bin/open`, `/usr/bin/plutil`, `/usr/bin/sips`.
- Comments sparse; code in modern idiomatic JS.

## 3. File manifest and ownership

| File | Owner |
|---|---|
| `server.js` | Builder A |
| `lib/util.js` | Builder A |
| `lib/scan.js` | Builder A |
| `lib/meta.js` | Builder A |
| `lib/effectors.js` | Builder B |
| `lib/store.js` | Builder B |
| `scripts/seed-demo.js` | Builder B |
| `package.json` | Builder B |
| `web/index.html` | Builder C |
| `web/css/main.css` | Builder C |
| `web/js/main.js` | Builder C |
| `web/js/bus.js` | Builder C |
| `web/js/state.js` | Builder C |
| `web/js/api.js` | Builder C |
| `web/js/filespace.js` | Builder D |
| `web/js/workspace.js` | Builder E |
| `web/js/effectors.js` | Builder F |
| `web/js/comms.js` | Builder G |

Builders create ONLY their own files. Integration agent may touch anything.

## 4. DOM contract (`web/index.html`)

```html
<body>
  <div id="app" data-layer="filespace">
    <header id="comms-strip"></header>
    <aside id="effector-panel"></aside>
    <main id="stage">
      <div id="filespace"><canvas id="filespace-canvas"></canvas></div>
      <div id="workspace"><div id="workspace-canvas"></div></div>
    </main>
  </div>
  <div id="layer-toggle">
    <button data-layer="filespace" class="active">Filespace</button>
    <button data-layer="workspace">Workspace</button>
  </div>
  <div id="tooltip" class="hidden"></div>
  <div id="toast-tray"></div>
  <script type="module" src="js/main.js"></script>
</body>
```

- `#app` is a CSS grid: `grid-template-rows: 96px 1fr; grid-template-columns: 232px 1fr;`
  `#comms-strip` spans both columns (row 1). `#effector-panel` row 2 col 1.
  `#stage` row 2 col 2, `position: relative; overflow: hidden;`.
- `#filespace` and `#workspace` are absolutely positioned to fill `#stage`.
- Layer visibility is driven ONLY by `#app[data-layer]`:
  - `data-layer="filespace"`: `#workspace` gets `opacity:0; pointer-events:none; transform: scale(1.04);`
  - `data-layer="workspace"`: `#filespace` content stays rendered but `#filespace`
    gets `opacity:.12; filter: blur(6px) saturate(.6);` and `pointer-events:none`,
    so the substrate glows faintly *behind* the Workspace (depth effect).
  - Both transition over 280ms ease.
- `#layer-toggle` is a fixed pill, bottom-center, always clickable.
- `#tooltip` is a fixed, pointer-events-none info card; any module may fill it.
- `#toast-tray` fixed top-right under the strip; `ui.toast(msg)` appends short-lived toasts.

## 5. Theme (CSS custom properties, defined in `:root` by Builder C)

```css
--bg: #07090f;          /* void behind everything */
--marble: #131a26;      /* uncarved stone */
--marble-vein: #1b2433; /* strata lines */
--carve: #0c1018;       /* excavated cavity background */
--chamber: #223046;     /* file chamber fill */
--chamber-hot: #2d4159; /* hovered */
--line: #2c3a52;        /* hairlines */
--ink: #c8d4e8;         /* primary text */
--ink-dim: #6b7a94;
--accent: #4cc9f0;      /* selection / sync / membrane cyan */
--gold: #f0b35e;        /* published / release */
--green: #69c98f;       /* shared */
--violet: #a78bfa;      /* agent-accessible */
--down: #5e9bf0;        /* downloaded */
--hot: #ff6b6b;         /* live change pulse */
--font: ui-sans-serif, -apple-system, "SF Pro", system-ui, sans-serif;
--mono: ui-monospace, "SF Mono", Menlo, monospace;
```

Design language: near-black field, hairline strokes, soft glows, minimal text,
no skeuomorphic chrome. Window chrome and panels are translucent dark glass
(`backdrop-filter: blur(14px)`), 10px radius, 1px `--line` border.

Builder C's `main.css` must include complete styles for ALL class names referenced
in this contract (sections 4, 9, 10, 11, 12), since other builders write JS only.

## 6. Event bus (`web/js/bus.js`, Builder C)

```js
export const bus = { on(evt, fn), off(evt, fn), emit(evt, payload) }
```
Plain Map-of-Sets implementation. `emit` is synchronous; handlers must not throw
(wrap handler calls in try/catch + `console.error`).

### Canonical events (full list — emit/consume exactly these)
| Event | Payload | Emitted by → consumed by |
|---|---|---|
| `tree:updated` | `{tree}` | api/main → filespace, effectors |
| `subtree:updated` | `{path, node}` | api → filespace |
| `disk:updated` | `{disk}` | main → filespace |
| `fs:changed` | `{path, kind}` | api (SSE) → filespace, main |
| `selection:changed` | `{paths: string[]}` | state → filespace, effectors |
| `layer:changed` | `{layer}` | state → main, workspace |
| `window:open` | `{title, kind, render, w?, h?}` | anyone → workspace |
| `proposal:created` | `{proposal}` | effectors → effectors(badge), workspace |
| `proposal:resolved` | `{id, action}` | effectors → filespace(refresh) |
| `release:start` | `{paths}` | effectors → filespace (launch particles) |
| `release:landed` | `{paths}` | filespace → comms (dock artifact chips) |
| `meta:updated` | `{metas}` | api → filespace |
| `effector:busy` | `{name, busy}` | effectors → effectors |

`render` in `window:open` is `function(contentEl) {}` — builds the window body with
DOM APIs (`textContent` only for data).

## 7. Shared state (`web/js/state.js`, Builder C)

```js
export const state = {
  root: null,           // absolute path string
  tree: null,           // root TreeNode (see §8)
  disk: null,           // {total, free, used, mount}
  selection: new Set(), // absolute paths
  layer: 'filespace',
  metas: new Map(),     // path -> string[] states
  proposals: [],        // open proposals
};
export function setLayer(layer)            // updates state + #app dataset + emits layer:changed
export function setSelection(paths)        // replaces; emits selection:changed
export function toggleSelection(path)      // add/remove; emits selection:changed
export function clearSelection()           // emits selection:changed
export function nodeByPath(path)           // walks state.tree, returns TreeNode|null
```
`setLayer` also updates both `#layer-toggle` buttons' `.active` class.

## 8. HTTP API contract (server, port **4173**, bind 127.0.0.1)

`TreeNode = { name, path, kind: 'file'|'dir'|'more', size, mtime, states: string[], children?: TreeNode[] }`
- `size` of a dir = recursive byte total. `mtime` = epoch ms.
- `'more'` nodes aggregate overflow (see scan limits) — `name` like `"… 312 more"`.
- `states` at scan time come from cheap rules + the substrate store (§13); deeper
  per-file detection arrives via `/api/meta`.

| Method+Path | Body | Response |
|---|---|---|
| `GET /api/root` | – | `{root}` |
| `POST /api/root` | `{path}` | `{root}` (validates: absolute, exists, dir) |
| `GET /api/disk` | – | `{total, free, used, mount}` bytes (statfs of root; fallback `df -k`) |
| `GET /api/tree` | – | root `TreeNode` |
| `GET /api/tree?path=ABS` | – | `TreeNode` of that subtree (must be inside root) |
| `POST /api/meta` | `{paths:[]}` (≤200) | `{metas: {[path]: string[] states}}` |
| `GET /api/events` | – | SSE; `event: change`, `data: {"path","kind"}` (debounced 250ms, coalesced per path) |
| `POST /api/effector/summarize` | `{paths}` | `{report}` (§14) |
| `POST /api/effector/classify` | `{paths}` | `{groups:[{label, count, bytes, paths}]}` |
| `POST /api/effector/duplicates` | `{paths}` | `{groups:[{hash, size, count, paths}]}` |
| `POST /api/effector/stale` | `{paths, days=180}` | `{items:[{path, mtime, size}]}` |
| `POST /api/effector/rename` | `{paths}` | `{proposal}` (§15) |
| `POST /api/effector/release` | `{paths}` | `{ok:true, released:[paths]}` (sets `published` state in store) |
| `POST /api/checkpoint` | `{paths, label?}` | `{checkpoint:{id, label, created, count, bytes}}` |
| `GET /api/checkpoints` | – | `{checkpoints:[]}` |
| `GET /api/proposals` | – | `{proposals:[]}` |
| `POST /api/proposal/:id/merge` | – | `{ok, applied:[{from,to}], errors:[]}` |
| `POST /api/proposal/:id/discard` | – | `{ok:true}` |

Errors: non-2xx with `{error: "message"}`. Every endpoint that takes paths MUST
resolve each with `path.resolve` and verify `resolved === root || resolved.startsWith(root + path.sep)`
(`lib/util.js → assertInside(root, p)`), else 400. Static files for `web/` are
served at `/` with the same containment check against the `web/` dir and correct
MIME types (`html,css,js,svg,png,json,ico`).

Server CLI: `node server.js [--root /abs/path] [--port 4173]`.
**Default root**: `<repo>/demo-substrate`; if missing, the server auto-runs the
seeder (import `scripts/seed-demo.js`'s exported `seed(dir)`) before first scan.

## 9. Filespace renderer (`web/js/filespace.js`, Builder D)

`export function initFilespace(container)` — owns `#filespace-canvas`, devicePixelRatio-
aware, re-renders on rAF only when dirty (events/interaction mark dirty).

### Block geometry
- The marble block fills the canvas except a `MEMBRANE_H = 26px` band at the very top.
- Walls: left/right/bottom edges of the block drawn as solid 3px strokes (`--line`,
  brightened) with a faint inner shadow — unmistakably hard.
- Membrane: the top band — horizontal animated shimmer (slow-moving cyan gradient,
  ~8s loop, low alpha) + a 1px bright line. Releases pass through only here.
- Marble texture: `--marble` fill with ~14 faint horizontal strata (`--marble-vein`,
  1px, slight waviness via fixed pseudo-random offsets seeded from index — no
  Math.random per frame).

### Carving layout (inverted icicle — compute in a pure function `layoutTree(tree, viewport)`)
- Carved region width = `clamp(state.tree.size / state.disk.total, 0.28, 0.86) * blockWidth`,
  anchored at `blockLeft + 40px`. The remaining block stays uncarved marble.
- Root node: a shaft from the membrane down, spanning the carved width, height 34px.
- Each level below: children laid left→right inside parent's x-extent, width
  proportional to `size` (min 3px; nodes that would be <3px collapse into the
  parent's `'more'` rendering). Level height: `max(26, 64 - depth*6)px`, plus a 4px
  carved gap between levels and 2px between siblings.
- Files = chambers: rounded-rect (4px) filled `--chamber`; dirs = galleries: slightly
  darker fill + 1px brighter top edge; the cavity behind everything is `--carve`.
- Max rendered depth 9; deeper content renders as a soft gradient "unexcavated depth"
  hint at the bottom of its ancestor.
- Labels: only when a node's box ≥ 64px wide → name (11px `--font`, `--ink-dim`,
  ellipsized) and, if ≥110px wide and ≥30px tall, human size below (9px `--mono`).

### Disk gauge
Along the inside of the bottom wall: a thin (5px) bar showing whole-volume
used/free (`used/total` filled `--ink-dim`, free transparent), with a tiny label
`"<used> / <total>"` (9px mono) right-aligned. This keeps the carving fraction honest.

### States and life
Per node, the union of `node.states` + `state.metas.get(path)`:
- `synced` → 1.5px `--accent` left edge tick; `downloaded` → `--down` tick;
  `shared` → `--green` tick; `published` → `--gold` full outline + faint gold glow;
  `agent-accessible` → `--violet` dashed outline; `checkpointed` → small ◆ glyph.
- On `fs:changed`: matching node (or nearest ancestor) pulses `--hot` glow decaying
  over 4s; also refetch that subtree (`api.getTree(parentPath)` → emit `subtree:updated`).
- Idle life: chambers' fill alpha breathes ±3% on a slow sine (per-node phase from
  hash of path). Subtle. The block should feel alive but calm.

### Interaction
- Wheel = zoom toward cursor (0.5×–8×); drag empty marble/cavity = pan; the camera
  is a simple `{x,y,z}` transform applied before drawing. Block geometry is computed
  in world units sized to the initial viewport.
- Hover → `#tooltip` shows name, kind, human size, mtime, states.
- Click node = select subtree (the node's path). Shift-click = toggle-add.
  Drag on nodes (not empty space) = lasso rectangle, selects intersecting nodes.
  Click empty marble = clear. Selected nodes: `--accent` 2px outline + 12% fill tint;
  also emits, and listens to, `selection:changed` (bidirectional with panel).
- After tree load, batch `api.getMeta()` for the ~150 largest visible nodes.

### Release animation
On `release:start {paths}`: for each path, a glowing gold particle rises from the
node's center, accelerates upward, squeezes through the membrane (brief membrane
ripple at crossing x), exits the top of the canvas. When all particles exit (~1.1s)
emit `release:landed {paths}`. While `data-layer="workspace"` it still runs (the
filespace is dimly visible behind).

## 10. Workspace (`web/js/workspace.js`, Builder E)

`export function initWorkspace(container)` and `export function openWindow(opts)`;
also subscribes to `window:open`.

- `#workspace-canvas` is a 100000×100000 plane; camera `{x,y,z}` applied as
  `transform: translate() scale()` (transform-origin 0 0). Wheel = zoom toward
  cursor (0.15×–3×); drag empty plane = pan. Camera starts centered at plane center.
- `openWindow({title, kind, render, w=560, h=420})` creates `.ws-window` at a
  cascading position near the current view center, calls `render(contentEl)`,
  focuses it (z-order), and returns its id. Structure:
  ```html
  <div class="ws-window" data-kind>
    <div class="ws-titlebar"><span class="ws-title"></span>
      <span class="ws-actions"><button class="ws-zoom">⤢</button><button class="ws-close">✕</button></span>
    </div>
    <div class="ws-content"></div>
  </div>
  ```
- Drag titlebar = move (divide pointer delta by camera z). Bottom-right 14px
  handle = resize. Click anywhere = focus.
- **Fullscreen = full zoom**: `.ws-zoom` button or double-click titlebar animates
  the camera (~340ms ease-in-out) so the window fills the stage with 4% margin.
  Same gesture again returns to the previous camera. Esc also returns.
- A fixed minimap (140×90, bottom-right of stage, only in workspace layer) shows
  window rects + camera viewport; click to jump.
- If a `window:open` arrives while in filespace layer, call `setLayer('workspace')`
  first — flip, then the window appears.

## 11. Effector panel (`web/js/effectors.js`, Builder F)

`export function initEffectors(panelEl)` builds the left panel:

- Header: wordmark `SUBSTRATE` (11px letterspaced, `--ink-dim`) + current root
  basename + live selection readout (`n items · size`).
- Tool buttons (`.fx-btn`, icon glyph + label): Summarize 〽, Classify ⌘?, no —
  use plain glyphs: Summarize `Σ`, Classify `◫`, Duplicates `≡`, Stale `⏳`,
  Rename `✎`, Checkpoint `◆`, Release `↥`. Below a divider: `Proposals` (with
  count badge `.fx-badge`) and `Checkpoints`.
- Disabled (`.disabled`) when selection is empty — except Summarize/Classify/
  Duplicates/Stale, which fall back to the whole root. Release requires selection.
- Running an effector: mark button busy (pulse), call `api`, then
  `bus.emit('window:open', …)` with a report window (kind = effector name).
  Report rendering (DOM, no innerHTML for data):
  - **Summarize**: stat grid (items, bytes, files/dirs, types top-5, newest,
    oldest, largest) — large numerals, quiet labels.
  - **Classify**: rows per group: label, count, human bytes, horizontal bar scaled
    to bytes; clicking a row sets selection to the group's paths.
  - **Duplicates**: groups with hash prefix, n× size, member paths (mono, dim);
    "select all duplicates" button per group (selects all but first member).
  - **Stale**: rows path · age in days · size; "select all" button.
- **Rename** → `api.renameProposal` → `proposal:created` → opens a **Proposal
  window**: rows `from → to` (mono, arrow `--gold`), footer `[Discard] [Merge]`
  (`.btn-ghost` / `.btn-primary`). Merge → `api.mergeProposal` → toast result,
  `proposal:resolved`, refetch tree. Discard likewise.
- **Checkpoint** → `api.checkpoint(selection)` → toast `◆ checkpoint created`;
  Checkpoints button lists them in a window.
- **Release** → confirm inline on the button (`label → "sure?"` for 2.5s, second
  click confirms) → `api.release` → `bus.emit('release:start')` → flip to
  filespace (`setLayer('filespace')`) so the user SEES the ascent.
- Proposals button opens any open proposals (from `state.proposals`, refreshed
  via `api.getProposals()` at boot and on `proposal:*`).

## 12. Comms boundary layer (`web/js/comms.js`, Builder G)

`export function initComms(stripEl)` builds the top strip — the field ABOVE the membrane:

- Left: domain plaque — machine glyph `▣` + hostname-ish label (root basename) +
  caption `local domain · 3 walls sealed · membrane active` (10px, `--ink-dim`).
- Center: channel nodes (`.comm-chip`): `⌁ Web`, `✉ Mail`, `◌ Messages`, `⇄ AirDrop`,
  `☁ Cloud`, `⎇ Git`. Soft glass chips with idle glow; tiny activity dot that
  blinks occasionally (CSS animation, staggered) to suggest a live field.
- Clicking a chip opens its **channel console** window in the Workspace
  (`window:open`, kind `comms`): a unified-feed mock listing recent *boundary
  events* (releases this session, checkpoints, fs change counts) + a compose row
  (input + per-channel toggle pills + Send) that demonstrates **cross-channel
  dispatch**: "sending" appends the message to every toggled channel's feed and
  docks an outbound chip — clearly labeled `simulation — channels not connected`.
- On `release:landed {paths}`: an artifact chip (`.artifact-chip`, gold dot +
  basename) drops into the strip with a soft bounce, then settles in an
  "outbound" tray on the right (keep last 6, older fade out). Tooltip on hover:
  `released from local domain`.
- The strip's bottom edge carries a 1px `--accent` line — the membrane's upper
  surface — visually continuous with the Filespace membrane band.

## 13. Server: scan, watch, meta, store

### `lib/scan.js` (Builder A)
`export async function scanTree(root, opts)` → TreeNode. Rules:
- Skip entries named: `.git`, `node_modules`, `.Trash`, `Library` (at depth ≤1 of
  HOME roots), `.substrate` — represent each skipped dir as a leaf dir node with
  `size` from a fast du-style sum capped at 2s, `states:['opaque']`, no children.
  (Simplification allowed: size 0 + `opaque` if summing is awkward.)
- Per-dir cap 400 children (largest-first after sorting by size desc); overflow →
  one `'more'` node aggregating remaining count+bytes. Max depth 12. No symlink
  following (lstat). Dir `size` = recursive sum (computed during the same walk).
- Cheap states during scan: store states (§ store) merged; `downloaded` if under a
  path segment `Downloads`; `synced` if path contains `Mobile Documents` or
  `com~apple~CloudDocs`; name ends `.icloud` → `synced`.

### `lib/meta.js` (Builder A)
`export async function metaFor(paths)` → `{[path]: states[]}`. Per path (parallel,
capped 16): `xattr -p com.apple.metadata:kMDItemWhereFroms` exits 0 → `downloaded`;
`xattr` listing contains `com.apple.quarantine` → `quarantined`; walk-up for `.git`
→ `repository`. Merge store states. execFile failures → just omit (never throw).

### Watch (Builder A, in `server.js`)
`fs.watch(root, {recursive:true})`. Debounce 250ms, coalesce by path, drop
`.substrate/` and `.git/` events, broadcast SSE to all connected clients. Heartbeat
comment every 25s. On root change (POST /api/root): close + rewatch.

### `lib/store.js` (Builder B)
Substrate store at `<root>/.substrate/`:
- `state.json`: `{states: {[relPath]: string[]}}` — user-applied states (e.g.
  `published` from Release). API: `getStates(root)`, `addState(root, relPath, s)`.
- `proposals.json`: persisted open proposals. API: `list/get/add/resolve`.
- `checkpoints/` (see effectors). All writes atomic (tmp + rename). Lazy-create dir.

### `lib/effectors.js` (Builder B)
All take `(root, paths)` where paths are pre-validated absolute paths; operate on
each path's subtree (walk with the same skip rules; reuse scan.js helpers if exported).
- `summarize` → `{report: {items, files, dirs, bytes, types:[{ext,count,bytes}×5], newest:{path,mtime}, oldest, largest:{path,size}}}`
- `classify` → groups by category map: `docs(pdf,doc,docx,txt,md,rtf,pages)`,
  `images(png,jpg,jpeg,gif,svg,heic,webp)`, `av(mp4,mov,mp3,wav,m4a,mkv)`,
  `code(js,ts,py,swift,c,cpp,go,rs,sh,json,yml,yaml,html,css)`,
  `archives(zip,tar,gz,dmg,7z)`, `data(csv,sqlite,db,parquet)`, else `other`.
- `duplicates` → group files by size, then sha1 (stream, only files ≤ 64MB, only
  size-collisions); return groups with ≥2 members, sorted by wasted bytes desc.
- `stale(days)` → files with mtime older than days, sorted oldest first, cap 500.
- `renameProposal` → for each file basename: NFC-normalize; strip leading/trailing
  spaces; ` copy`/`Copy of ` (case-insensitive) removed; spaces & `_` → `-`;
  collapse `-{2,}` → `-`; lowercase extension; never touch dotfiles; skip if
  unchanged or target exists. Proposal `{id, kind:'rename', created, actions:[{from,to}]}`
  (id = `p_` + 6 random hex). Empty actions → still return proposal with `actions: []`.
- `mergeProposal` → apply renames with `fs.rename`, skip+record error if target
  now exists; mark resolved; return `{applied, errors}`.
- `checkpoint(paths, label)` → copy each path into
  `<root>/.substrate/checkpoints/<id>/<relPath>` via `fs.cp(recursive)` (apply the
  same skip rules by copying via a filter for `.git`/`node_modules` if convenient;
  otherwise raw cp is acceptable for MVP). Record `{id, label, created, count, bytes}`
  in `checkpoints/index.json`. Also `addState` `checkpointed` on each path.
- `release` → `addState(published)` per path; return released paths.

### `scripts/seed-demo.js` (Builder B)
`export async function seed(dir)` + CLI (`node scripts/seed-demo.js [dir]`).
Creates `demo-substrate/` (~40–60 entries, a few MB total): `Projects/aurora-app`
(small code tree incl. README, src files), `Projects/old-site` (stale: utimes set
2022), `Documents` (reports with messy names: `Final Report  copy 2.PDF`,
`meeting notes_v3 FINAL.txt`), `Media` (a few generated binary blobs 0.5–2MB,
duplicated across `Media/raw` and `Media/export` for dup detection),
`Downloads` (installer-ish names), `Inbox drop` etc. Write `.substrate/state.json`
seeding states: one path `synced`, one `shared`, one `agent-accessible`, one
`published`. Deterministic content (no Date.now in names). Idempotent: wipe+recreate.

### `package.json` (Builder B)
`{ "name":"substrate-os", "private":true, "type":"commonjs", "engines":{"node":">=18"},
"scripts": { "start":"node server.js", "demo":"node scripts/seed-demo.js && node server.js" } }`
NOTE: all server/lib/scripts files are CommonJS (`require`); web/js are ES modules
(browser). Keep it that way.

## 14. `web/js/api.js` exports (Builder C)

```js
getRoot(), setRoot(path), getDisk(), getTree(path?), getMeta(paths),
runEffector(name, body)  // generic POST /api/effector/<name>
checkpoint(paths,label?), getCheckpoints(),
getProposals(), mergeProposal(id), discardProposal(id),
connectEvents()  // EventSource → bus.emit('fs:changed', …); auto-reconnect 3s
```
All throw `Error(json.error || status)` on non-2xx. `web/js/main.js` boot sequence:
`getRoot → getDisk → getTree → emit tree:updated/disk:updated → init modules
(filespace, workspace, effectors, comms) → connectEvents → getProposals → Tab key
binding (preventDefault; flips layer via setLayer) → Esc clears selection (filespace
layer only; workspace handles its own Esc)`.

## 15. Spec-fidelity checklist (the demo must show all of these)

1. Tree rooted at the TOP, carving DOWNWARD through storage — sculpture-from-marble;
   uncarved marble visibly = free bits.
2. Three impenetrable walls; top membrane selectively permeable.
3. Web boundary ABOVE the tree root; releases get pulled UP through the membrane.
4. Comms apps live at the top as a boundary layer, with cross-channel compose.
5. Effector apps in a LEFT panel acting on the tree.
6. Tree free to grow right/down — nothing in its way.
7. App windows open in a Workspace layer overlaying the Filespace.
8. Instant flip between Workspace and Filespace (Tab + toggle).
9. Workspace = infinite zoomable canvas; fullscreen = full zoom to a window.
10. Storage shown as visual mass (area ∝ bytes) + whole-disk gauge.
11. Recent changes pulse with motion (live fs watch).
12. Boundary states visibly marked (synced/downloaded/shared/published/agent/checkpointed).
13. Region selection (click/shift/lasso).
14. Safe effectors: summarize, classify, duplicates, stale, rename, checkpoint, release.
15. Mutations are proposals: preview → merge/discard. Nothing writes silently.

---

## 16. Addendum — v2: real tree visual + installed Mac apps as effectors

This addendum amends §9, §11, §13, §14. Where it conflicts with the original
text, the addendum wins. Keep everything not mentioned here unchanged.

### 16.1 Filespace becomes an actual TREE (rewrite §9 layout, keep everything else)

The Filespace must read unmistakably as a **node-link tree** — a trunk descending
from the membrane, branches forking down and out, leaves at the tips — NOT a
treemap of rectangles. Everything else in §9 (DPR canvas, marble block, 3 hard
walls, animated membrane band, disk gauge on the bottom wall, camera pan/zoom
toward cursor, hover tooltip, click/shift/lasso selection wired to state, meta
batch fetch, fs:changed pulse + subtree refetch, idle breathing, release particle
ascent through the membrane) is PRESERVED. Only the layout + node/edge drawing
changes.

Layout (`layoutTree(tree, viewport)` stays a pure function, now producing nodes +
links):
- **Root** sits at the top center of the carved cavity, just below the membrane.
- **Top-down tidy tree**: y by depth (level spacing ~ `max(64, 132 - depth*8)`
  world px, so upper levels breathe and deep levels tighten). x by a mass-weighted
  partition: each node owns a horizontal band proportional to
  `weight = max(leafCount, sqrt(bytes))`; a parent is centered over the span of its
  children. Guarantee a minimum horizontal gap (≥ node diameter + 6px) between
  siblings so nodes never overlap; the tree may extend rightward and downward
  freely (the stage scrolls/zooms — nothing is in its way).
- **Links**: smooth cubic-bezier from the parent's bottom to each child's top,
  drawn as **tapered branches whose stroke width ∝ the child subtree's bytes**
  (`clamp(2..14)` world px, scaled by camera) — this carries the storage-mass cue
  the founder wants. Color: a vein→carve gradient that brightens near the nodes;
  selected branches and branches under a hovered node brighten.
- **Nodes**:
  - **Directory = branch node**: a filled disc, radius ∝ `clamp(log2(subtreeBytes))`
    (≈ 5..16 world px), `--chamber` fill, brighter rim (`--line` → accent on hover),
    soft glow. Directories with collapsed overflow keep the `'more'` child as a small
    leaf labeled like `"… 312 more"`.
  - **File = leaf**: a smaller disc/teardrop, radius ∝ `clamp(log2(bytes))`
    (≈ 3..10), `--chamber` fill. Tiny zero-byte files get the floor radius.
  - Depth cap stays 9; beyond it, draw a faint downward "unexcavated depth" wisp
    from the deepest drawn node instead of more nodes.
- **States** (union of `node.states` + `state.metas`): render as a colored **ring
  or arc around the node** (not a left-edge tick): `synced`→accent, `downloaded`→
  `--down`, `shared`→`--green`, `published`→full `--gold` ring + gold glow,
  `agent-accessible`→`--violet` dashed ring, `checkpointed`→a small ◆ beside it.
- **Selection**: selected nodes get an `--accent` ring + glow and tint their
  subtree's branches; the whole clicked subtree counts as selected (path-based, as
  before). Hover still fills `#tooltip` with name/kind/size/mtime/states.
- **Labels**: draw a node's name (and, when room allows, human size) next to the
  node when the node's on-screen radius ≥ ~7px OR camera z ≥ ~1.3; ellipsize; keep
  the calm, minimal, hairline aesthetic. Avoid label spam at low zoom.
- Performance: still rAF-redraw-only-when-dirty-or-animating; precompute the layout
  once per tree/disk change; no per-frame allocations in the hot path; deterministic
  jitter only (no per-frame randomness).

### 16.2 Installed Mac apps as effectors (amends §11 panel, §13 server, §14 api)

The left panel gains an **"Applications"** section beneath the substrate tools
(Summarize…Release) and above/below Proposals & Checkpoints. It lists REAL apps
installed on this machine, each acting as an effector on the current selection.

Server (Builder-owned: `server.js` + new `lib/apps.js`):
- `GET /api/apps` → `{apps:[{name, path, icon}]}` where `path` is the absolute
  `.app` bundle path and `icon` is `"/api/appicon?path=<encoded .app path>"`.
  Enumerate `*.app` (and `Utilities/*.app`) in `/Applications`,
  `/System/Applications`, and `~/Applications`. `name` = `CFBundleDisplayName` or
  the basename without `.app`. Sort alpha, dedupe by name, cap 120.
- `GET /api/appicon?path=<.app>` → PNG bytes. Resolve `CFBundleIconFile` from the
  bundle's `Info.plist` (via `/usr/bin/plutil -convert json -o - Info.plist`),
  append `.icns` if missing, then `/usr/bin/sips -s format png -Z 64 <icns> --out
  <cache.png>` into a cache dir (`os.tmpdir()/substrate-icons/<sha1>.png`). Serve
  cached file on repeat. On any failure → 404 (frontend falls back to a glyph).
  `Cache-Control: max-age=86400`.
- `POST /api/open-with {app, paths}` → opens the given substrate paths in the app.
  `/usr/bin/open -a <app> <paths...>` via **execFile** (never a shell). With no
  paths, just launch the app (`open -a <app>`).
- `POST /api/reveal {paths}` → `/usr/bin/open -R <firstPath>` (reveal in Finder).
- **SECURITY (mandatory)**: `app` MUST resolve (realpath) to a path ending in
  `.app` that is contained within one of the allowed app roots above — reject
  anything else with 400 (this is the command-injection / arbitrary-exec guard,
  since `open -a` could otherwise be pointed at any bundle). Every entry of `paths`
  MUST pass `assertInside(ROOT, p)`. `appicon` path MUST likewise be an allowed
  `.app`. All execFile calls get a timeout. These endpoints are still behind the
  loopback-host + `X-Substrate` mutation guard already in `server.js`.

Frontend (`web/js/api.js` + `web/js/effectors.js` + `web/css/main.css`):
- `api.js`: add `getApps()`, `openWith(app, paths)`, `reveal(paths)`.
- `effectors.js`: render the Applications section. Each app = a `.app-chip`
  (a 64px-ish square or a row) showing the real icon (`<img>` with
  `src=/api/appicon?path=…`, `loading="lazy"`, alt=name, `onerror` → swap to a
  glyph fallback span) + the app name (`textContent`). Section is scrollable if it
  overflows (panel gets `overflow-y:auto`). Clicking an app:
    - if there is a selection → `openWith(app.path, [...selection])` and toast
      `"↗ opened N items in <app>"`;
    - if no selection → `openWith(app.path, [])` (just launches the app) and toast
      `"launched <app>"`.
  Provide a small "Reveal in Finder" affordance for the current selection too
  (a row/button near the section header) calling `reveal([...selection])`.
  Fetch the app list once at init (`getApps()`); render lazily; never block the
  panel if the call fails (catch → show nothing / a quiet note).
- `main.css`: style `.apps-section`, `.app-chip`, `.app-icon`, `.app-name`, the
  scroll area, and the reveal affordance, in the existing calm dark-glass language.
