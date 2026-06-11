# Substrate OS

A visual operating layer for your local digital domain — MVP prototype.

Substrate OS inverts the desktop metaphor. Your storage is shown as a solid block
of marble; the file tree is an **excavation carved downward from the top**. Files
are chambers whose area is proportional to their size, uncarved marble is free
space — empty bits are still bits. The block has three impenetrable walls; the
top edge is a **selectively permeable membrane**. Everything that leaves the
machine — uploads, publications, messages — is pulled *up* through the membrane
into the comms/web boundary field above.

## Run it

```sh
npm run demo    # seeds ./demo-substrate and starts the server
# or
npm start                         # serves ./demo-substrate (auto-seeds if missing)
node server.js --root /some/path  # point it at a real folder
```

Then open http://127.0.0.1:4173.

Zero dependencies — pure Node (>= 18) backend, vanilla-JS frontend, no build step.

## The layout

- **Top strip** — the comms/web boundary layer, above the membrane. Channel nodes
  (Web, Mail, Messages, AirDrop, Cloud, Git) with a cross-channel compose console
  (simulated; nothing actually connects). Released artifacts dock here.
- **Left panel** — effector tools that act on the substrate: Summarize, Classify,
  Duplicates, Stale, Rename, Checkpoint, Release.
- **Main stage** — the marble block. The tree digs downward and grows rightward,
  nothing in its way. A gauge on the bottom wall shows whole-disk used/free.
- **Workspace** — an infinite zoomable canvas overlaying the Filespace where app
  windows (reports, proposals, channel consoles) open. *Fullscreening a window is
  just zooming to it.*

## Controls

| Input | Action |
|---|---|
| `Tab` or bottom toggle | flip Filespace ⇄ Workspace |
| wheel | zoom (toward cursor, both layers) |
| drag empty space | pan |
| click node | select subtree · `shift`-click adds · drag lassoes |
| `Esc` | clear selection / exit window zoom |
| double-click a window titlebar or ⤢ | full-zoom to window |

## Sovereignty rules

- The server binds to 127.0.0.1 only and refuses any path outside the chosen root.
- Mutating effectors produce **proposals**: previewed in a window, then explicitly
  merged or discarded. Nothing writes silently.
- Checkpoints are restorable copies under `<root>/.substrate/checkpoints/`.
- "Release" marks state and animates the ascent — nothing is actually uploaded.
- Boundary states are visible on the tree: synced, downloaded, shared, published,
  agent-accessible, checkpointed.

## Layout of the repo

- `server.js`, `lib/` — zero-dep Node server: scanner, fs watcher (SSE), xattr/git
  boundary-state detection, effectors, proposal + checkpoint store.
- `web/` — ES-module frontend: canvas Filespace renderer, infinite-canvas
  Workspace, effector panel, comms strip.
- `scripts/seed-demo.js` — deterministic demo substrate (messy names, duplicates,
  stale files, seeded boundary states).
- `docs/ARCHITECTURE.md` — the full architecture contract.
- `PROJECT_SUMMARY.md` — the concept document.
