# Substrate OS

Substrate OS is a macOS-native operating environment that runs on top of macOS rather than replacing the kernel or underlying system. It is a post-desktop operating layer: a visual, spatial interface for seeing and acting on the user's local and networked digital substrate.

The core idea is to invert the traditional desktop metaphor. Instead of treating applications, windows, and folders as the primary organizing objects, Substrate OS treats files, folders, app documents, messages, web resources, local data, and publication states as one coherent substrate. Applications and AI agents become effector tools that act on selected regions of this substrate rather than owning the user's workflow.

## Conceptual Thesis

A modern personal computer is no longer just a local file cabinet. It is a bounded private domain inside a larger internet-scale field. Local files, cloud-synced documents, downloads, uploads, shared resources, published artifacts, messages, and app-specific data all coexist, but their boundaries are usually invisible.

Substrate OS makes those boundaries visible.

It aims to show where data is local, private, shared, uploaded, downloaded, synced, agent-accessible, or published. The goal is to give users a more legible, sovereign, and spatially intuitive relationship with their machine.

## Core Goals

- Replace the desktop/file-window metaphor with a visual operating layer.
- Treat the local machine as a private subset of the larger internet and web.
- Make boundaries between local, shared, uploaded, downloaded, and published states visually explicit.
- Consolidate inbound and outbound interactions into controlled boundary channels.
- Show the machine in a Web View as a bounded local domain connected to a larger network field.
- Show the machine in a Local View as a file tree rooted at the bottom and growing upward.
- Display storage usage visually through mass, density, thickness, or related spatial cues.
- Show applications as floating effector tools that can summarize, classify, rename, propose branches, publish, transform, or otherwise act on selected substrate.
- Add branch and versioning concepts so changes can be proposed, previewed, merged, discarded, shared, or published.
- Eventually support AI-native plugins with declared permissions and controlled access to local, private, shared, and published substrate.

## Design Direction

Substrate OS should use minimal text and emphasize visual/spatial intuition over menu-heavy interaction. It should feel organic in structure and behavior, but not literally biological. The visual direction is closer to a calm operating field, network, or bounded domain than a plant, cell, or organism.

The interface should make the computer feel like a legible territory: a domain with internal structure, edges, flows, histories, and controlled points of interaction with the outside world.

## Primary Views

### Local View

Local View represents the machine's substrate as a file tree rooted at the bottom and growing upward. This reverses the conventional top-down file hierarchy and gives the local machine a grounded, spatial structure. Storage usage can be represented through visual mass, density, branch thickness, clustering, or sediment-like accumulation.

### Web View

Web View represents the local machine as a bounded domain within a larger network field. Downloads, uploads, cloud syncs, shared folders, web publications, APIs, repositories, and external services appear as flows or channels crossing the machine's boundary.

This view should make the distinction between private local substrate and external/public network states perceptually obvious.

## Effector Tools

Applications and AI agents should appear as tools that act on selected substrate. Possible effectors include:

- Summarize selected files or folders.
- Classify and cluster related items.
- Rename files or propose naming branches.
- Detect duplicates and stale artifacts.
- Convert or transform file formats.
- Extract metadata or entities.
- Create checkpoints.
- Propose branches.
- Preview diffs.
- Merge or discard changes.
- Package a region for sharing.
- Publish a selected artifact.
- Redact private data before upload or publication.

The user should remain in control of state transitions. Any significant change should be proposed, previewed, and explicitly accepted before being merged into the substrate.

## Branching and Versioning

Substrate OS should bring Git-like concepts into ordinary personal computing without requiring users to think like software developers. Changes can be treated as proposed branches or alternate paths that may be previewed, merged, discarded, shared, or published.

Potential user-facing concepts include:

- Checkpoint: a restorable state.
- Branch: an alternate proposed state.
- Preview: a visual diff before accepting a change.
- Merge: integrate a proposed change.
- Discard: dissolve an unwanted proposal.
- Release: publish an artifact outside the local domain.

## Data Model

Internally, Substrate OS should likely be modeled as a graph rather than only a file tree. The file tree is one projection of a richer substrate graph.

Example node types:

- File
- Folder
- Message
- URL
- App document
- Repository
- Artifact
- Collection

Example edges:

- contains
- derived_from
- copied_to
- uploaded_to
- downloaded_from
- referenced_by
- opened_with
- shared_with
- published_as
- branched_from
- merged_into

Example states:

- private
- local
- shared
- synced
- uploaded
- downloaded
- published
- agent-accessible
- archived
- ephemeral

## MVP Direction

A practical first version could be a macOS app that visualizes a user-selected root folder as a living local substrate. It watches changes in real time, displays storage usage visually, detects simple boundary states, and lets the user run a few safe effectors on selected regions.

Initial MVP capabilities:

1. Select a root folder.
2. Build a visual upward-growing tree.
3. Represent file size as visual mass or thickness.
4. Show recent changes with subtle motion or highlighting.
5. Mark boundary states such as local, synced, shared, downloaded, and published where detectable.
6. Select a cluster or region.
7. Run safe effectors such as summarize, classify, duplicate detection, rename proposal, and checkpoint creation.
8. Preview changes before writing them.
9. Merge or discard proposed changes.

## Strategic Positioning

Substrate OS sits at the intersection of:

- Finder replacement
- Spatial computing interface
- Local-first AI workspace
- Personal data sovereignty
- Visual Git for normal users
- Post-desktop shell
- AI agent permission layer

A concise product framing:

> A visual operating layer for your local digital domain.

A more ambitious framing:

> The post-desktop layer for local-first, AI-mediated computing.

The central product insight is that users need to see and control the boundary states of their data. Substrate OS makes the machine legible as a bounded domain: private when private, shared when shared, published when published, and agent-accessible only when explicitly permitted.
