# dsh-brain-viewer

An **AI brain viewer** for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness):
a brain-shaped relationship graph that opens from the left sidebar, plus a Markdown
knowledge-base pipeline that turns a folder of notes into that graph.

## What it does

- **Left sidebar entry** — a `🧠 AI Brain` button at the bottom of the sidebar opens a
  full-screen relationship graph.
- **Brain-shaped layout** — thousands of notes are packed into a real brain silhouette
  (sampled from the 🧠 emoji outline), with cluster hubs, drifting neurons, hover
  highlighting, drag-and-rebound and synapse pulses.
- **Knowledge pipeline included** — `brain/` ships the full Markdown pipeline:
  scan a workspace (`md` / `docx` / `xlsx`) → split documents into memory units →
  write Obsidian-compatible `[[wiki-link]]` notes → compile the graph.
- **Session auto-review ingest (v0.4.0)** — one click in the panel header turns today's DSH
  sessions into episode memories in the vault and rebuilds the graph. Fully local, no LLM calls.
- **Demo data** — the package ships a generic demo vault, so it works out of the box.
  Nothing personal is bundled.

## Install

```bash
dsh plugin --profile desktop add dsh-brain-viewer
```

Then fully quit and reopen DSH. The `🧠 AI Brain` button appears at the bottom of the
left sidebar.

## Build your own brain

Requirements: Node.js 20+ and Python 3.8+ (only for rebuilding; the viewer itself has
no Python dependency).

```bash
# inside the installed package, or from a local checkout
node tools/rebuild.mjs --workspace "D:/my-notes"   # scan your own folder
node tools/rebuild.mjs --demo                      # restore the demo brain
# data lands in brain/graph.json — reopen the panel, no page refresh needed
```

The pipeline writes memory notes to `brain/vault/` and generates `brain/graph.json`,
which the panel reads live.

## Live sync

```bash
# watch a Markdown vault (e.g. the vault your DSH memory skill writes to)
node tools/watch.mjs --vault "C:/path/to/vault"

# or watch a documents folder (md / docx / xlsx)
node tools/watch.mjs --workspace "D:/my-notes"
```

Changes are debounced (2.5s) and the graph is rebuilt in ~1-3s. The panel re-fetches
`/api/dsh-brain/graph` **every time it opens**, so reopening it shows the latest graph —
no repack, no page refresh.

## Data source (v0.3.1)

The panel no longer embeds data; it asks the host:

```
GET /api/dsh-brain/graph  →  brain/graph.json
```

- Default: the plugin's own `brain/graph.json` (demo data, or whatever `rebuild.mjs` wrote).
- To point elsewhere (e.g. the graph produced by your vault skill):

```json
// ~/.dsh/brain-viewer.config.json
{ "graphPath": "C:/path/to/ai-brain/graph.json" }
```

Restart DSH once so the host route is loaded; after that, data changes only need reopening
the panel.

## Session auto-review ingest (v0.4.0)

Every DSH session is a zstd-compressed JSONL log at
`~/.dsh/sessions/<workspace>/<session-id>/session.v4.jsonl.zstd`. The panel header now has a
**Session ingest** button plus a status line (`N ingested today · latest YYYY-MM-DD · M sessions visible`).
It turns **today's** sessions into one episode memory per session:

| Route | What it does |
| --- | --- |
| `GET /api/dsh-brain/ingest/status` | today's ingested count, latest memory date, visible sessions |
| `POST /api/dsh-brain/ingest/run` | scan today's sessions → write episode notes → rebuild the graph → `{written, updated, skipped, nodes}` |

Extraction is local, deterministic and does **not** call a model: the first real user message
becomes the title, user intents and the assistant's final text become the body, tool usage is
summarised, and the note is linked to 2–3 existing hub notes. Notes land in
`vault/episodes/YYYY-MM/YYYY-MM-DD · 会话复盘 · <title> (<session-id>).md`.

**Idempotent** — each generated note carries `source: dsh-session-ingest` and `session: <id>` in
its frontmatter. Clicking again rewrites the *same* file only when the session changed; it never
duplicates notes. Subagent (child) sessions and sessions from other workspaces are skipped by
default (`includeSubagent: true` to opt in).

Configure the vault — `vault/` and `build_graph.py` are inferred from `graphPath` when possible:

```json
// ~/.dsh/brain-viewer.config.json
{
  "graphPath": "C:/path/to/ai-brain/graph.json",
  "vaultPath": "C:/path/to/ai-brain/vault",
  "sessionsPath": "C:/Users/me/.dsh/sessions",
  "workspaceRoot": "C:/path/to/workspace",
  "python": "python"
}
```

Only `graphPath` or `vaultPath` is required. Without a configured vault the plugin **refuses to
write**, so the bundled demo vault is never polluted. Same workflow from the CLI:

```bash
node tools/ingest.mjs --status     # read-only: ingested today / latest memory / visible sessions
node tools/ingest.mjs --dry-run    # preview which notes would be written, write nothing
node tools/ingest.mjs              # write episode notes + rebuild the graph
node tools/ingest.mjs --date 2026-11-08
```

Requirements: a Node with zstd support for ingest (Node >= 22.15 or >= 23.8; DSH ships Node 24)
and Python only for the graph rebuild. If `build_graph.py` fails, the notes are still written and
the response reports `graph.ok: false` plus a warning.

## Performance (v0.3.1)

- **WebGL batch rendering**: nodes are instanced quads and links a single `gl.LINES` batch; pan/zoom only updates a matrix instead of rebuilding geometry. A 6,398-node graph renders in **0.6–1.2 ms per frame** (the old Canvas2D path was ~90 ms/frame).
- **Render on demand**: no `requestAnimationFrame` at all while nothing is animating or interacting (0 frames at rest) — the same strategy as Obsidian's graph view. Continuous frames only while the drift / pulse toggles are on.
- **Label LOD**: labels appear by zoom threshold, capped at 64 with overlap culling; labels and highlights live on a separate 2D overlay that draws only the few needed.
- **Data over a host route**: `client.js` dropped from 1 MB to ~0.1 MB; data never ships in the bundle and changes need no repack.
- Without WebGL it falls back to batched 2D paths and still renders on demand.
- Closing the panel unmounts the iframe, so it costs no CPU when idle.

## Privacy

- The demo vault is generated from generic content (`brain/seed_demo.py`).
- `tools/rebuild.mjs --workspace` reads files **locally only**; nothing is uploaded.
- The graph is rendered in an iframe from a local Blob URL; no network requests.

## Uninstall

```bash
dsh plugin --profile desktop remove dsh-brain-viewer
```

Or delete `dsh-brain-viewer` from the profile's `dsh.profile.bundles`.

## License

MIT

## Troubleshooting: the sidebar button disappears after restart

DSH runs `pnpm install` on every start. If the plugin is only in `dsh.profile.bundles` but not in
`dependencies`, pnpm treats it as "not in the dependency tree" and moves it to `node_modules/.ignored/`.

The correct install (what `install.mjs` does):

1. keep the plugin in `<profile>/local-plugins/dsh-brain-viewer`
2. record `"dsh-brain-viewer": "link:./local-plugins/dsh-brain-viewer"` in `dependencies`
3. run `pnpm install` so the lockfile records the link
4. restart DSH

If pnpm fails on `minimumReleaseAge` / supply-chain policy (a transitive package missing from the mirror
manifest), add it to `minimumReleaseAgeExclude` in the profile's `pnpm-workspace.yaml`.
