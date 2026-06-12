# uishot — Design Spec

**Date:** 2026-06-12
**Status:** Approved direction, pre-implementation
**Repo:** standalone OSS (`TimCrooker/uishot`), npm package `uishot`, MIT

## Problem

Agents are slow at iterating on real UI. The loop today is: boot Playwright, re-discover auth, re-discover routes, drive the app page by page, screenshot, load, repeat — paying browser boot, navigation, and token cost on every iteration, and re-figuring out the same app structure every session. Visual iteration velocity is the bottleneck, not code-writing ability.

## Vision

Make every screen and state of a web app **addressable and instantly capturable**. One command returns fresh screenshots of any screen, any named state, any viewport sizes, in ~1–2s warm, as predictable file paths. The agent's loop becomes: edit → HMR → `uishot snap` → Read image → edit.

The durable knowledge (routes, auth, interaction recipes, feature boundaries) lives in a checked-in manifest that agents seed once and maintain incrementally — nothing is ever re-figured out.

## Core reframe: addressable, not exhaustive

Screenshotting "every possible state" is combinatorially impossible. The goal is that any state an agent cares about can be **named once, then reproduced instantly forever**. Three tiers:

1. **Route states** — a URL + viewport. Auto-discoverable. `uishot snap items.detail`
2. **Named interaction states** — small deterministic action recipes stored in the manifest (`click → waitFor`), recorded once, replayed in milliseconds against a warm browser. `uishot snap orders.detail --state refund-modal`
3. **Ad-hoc states** — inline actions composed during iteration: `--do "click:[data-testid=refund]"`. One command (`promote`) saves a working chain as a named state. The manifest grows organically from what's actually worked on.

## Design principles (agent-first, the ai-context-kit philosophy)

uishot is built from the ground up to be **agentically paired**: the primary user is an agent in a coding harness, the human is the supervisor.

- **The CLI is the API.** Works in any agent with a shell. Every command supports `--json`. Default stdout is the minimal useful payload (file paths), never prose walls.
- **Errors teach repair.** Every failure states what broke, shows evidence (a screenshot of the stuck state for recipe failures), and names the exact command to fix it. An error message is a prompt.
- **Knowledge is versioned, not session-bound.** The manifest is the single durable artifact. Agents read it, extend it, and repair it; `uishot verify` proves it still replays (CI-able).
- **The package ships its own skills.** Like ai-context-kit, uishot installs agent skills into the consumer repo so any agent immediately knows the workflow (init, iterate, promote, repair). Docs are written for agents first.
- **Deterministic over clever.** Tiny action vocabulary, explicit waits, stable selectors. If a state needs a 15-step recipe, the right fix is a deep-linkable URL in the app, and the tool should say so.

## Core concepts

### Manifest

Checked into the consumer repo at `uishot.config.ts` (typed, schema-validated; screens/states may split into `uishot.screens.yaml` if the file gets large — decided at implementation by ergonomics, not now).

- **app**: dev server base URL — resolved from env (`process.env.APP_URL`-style), never hardcoded; fail with a clear message if missing.
- **viewports**: named presets (`sm: 390×844`, `md: 768×1024`, `lg: 1440×900`, …) + default set.
- **sessions**: named auth recipes (`default`, `admin`, `anon`) — either an action recipe against the login screen or a token-injection script hook. Daemon executes once, persists Playwright `storageState`, re-runs on expiry detection.
- **screens**: `{ id, route, feature, readyWhen? }` — `readyWhen` is a selector/condition that gates "the screen is actually rendered."
- **states**: per screen, named recipes: ordered steps from the action vocabulary.

### Recipe engine

Action vocabulary (intentionally tiny): `goto, click, fill, select, hover, press, scrollTo, waitFor, waitMs (discouraged, capped)`. Selector guidance: prefer `data-testid` / ARIA roles. On failure: capture the stuck state, report the failing step index + selector, exit nonzero. `uishot verify [--feature x]` replays all recipes headlessly and reports rot in one pass.

### Daemon (`uishotd`)

Per-project background process, autostarted by the first CLI call, unix socket at `.uishot/daemon.sock`.

- Owns one Playwright browser; pool of contexts keyed by session, kept authed and warm.
- Executes capture jobs; parallelizes across contexts for feature/all sweeps.
- Health: watches dev-server reachability and auth validity; self-heals (re-auth, context recycle); `uishot doctor` reports and force-heals; idle shutdown after a configurable period.
- The daemon is an implementation detail — the CLI contract never requires the user/agent to manage it, only allows it (`uishot daemon stop/status`).

### Surface adapter seam

Capture targets implement a `Surface` interface: `createSession(sessionConfig)`, `goto(route)`, `act(step)`, `capture(viewport) → png`. v1 ships `BrowserSurface` (Playwright). An `ExpoSimSurface` (iOS simulator) slots in later without touching the CLI, manifest, or recipe layers. The manifest schema reserves a per-screen `surface` field (default `browser`).

## CLI surface (v1)

```
uishot init                                # auto-discover routes (router conventions + authed crawl), seed manifest, install skills
uishot snap <screen|route|url> [--state s] [--do "<action>:<arg>"]... [--sizes sm,lg] [--session admin] [--json]
uishot feature <tag> [--sizes ...]         # all screens+states in a feature, parallel
uishot all                                 # full sweep
uishot diff <screen> [--state] [--sizes]   # capture + pixel-diff vs previous capture; % changed + diff image
uishot promote <screen> --name <state>     # persist the last --do chain on that screen as a named state
uishot list [--feature tag] [--json]       # everything addressable
uishot verify [--feature tag]              # replay all recipes, report rot
uishot doctor                              # daemon/auth/dev-server health + auto-heal
uishot daemon <status|stop>
```

## Output contract

- PNGs at `.uishot/shots/<screen>/<state>@<WxH>.png` (`base` state for plain routes). Stable, predictable paths — the agent can guess them.
- `index.json` per capture run: screen, state, size, path, timestamp, git SHA of the app repo, console-error count, recipe failures.
- Diff mode: `...@<WxH>.diff.png` (highlighted) + changed-pixel % in stdout/JSON. Previous capture is kept as the implicit baseline (one level of history; no baseline management system in v1).
- stdout default: one line per produced file path. `--json` for the full record.
- `.uishot/shots/` is gitignored; the manifest is not.

## Agentic pairing layer

- **Shipped skills** (installed into consumer repo by `uishot init`, Claude/codex-compatible layout like ai-context-kit): 
  - `uishot` — the iteration workflow: when to snap vs diff vs feature-sweep, how to read failures, promote discipline, manifest maintenance rules.
  - `uishot-init` — pairing protocol for first-time setup: agent walks the app with `--do` in record fashion, builds auth recipe + seed states, commits manifest.
- **Init is a dialogue, not magic.** `uishot init` does the deterministic part (route discovery, scaffold); the skill guides the agent through the judgment part (auth, which states matter, feature tags).
- **Self-describing failures.** e.g. `recipe orders.detail/refund-modal failed at step 2 (click [data-testid=refund]): not found. Stuck-state: .uishot/shots/orders.detail/__failed-refund-modal@1440x900.png. Fix the recipe in uishot.config.ts or re-record with: uishot snap orders.detail --do ... && uishot promote ...`

## Repo & stack

- Standalone repo `~/uishot` → `github.com/TimCrooker/uishot`. MIT.
- pnpm monorepo mirroring ai-context-kit: `packages/core` (manifest schema, recipe engine, surface interface, capture orchestration), `packages/daemon`, `packages/cli`, `packages/skills` (shipped skill assets). tsup builds, vitest, changesets for release, Node ≥ 20.
- Playwright as a library dependency (consumer installs browsers via `uishot init` prompt → `playwright install chromium`).
- Static ES imports only. No hardcoded URLs/ports — env or manifest.

## Testing

- Unit: manifest schema validation, recipe parsing, path/index generation, diff math.
- E2E: a fixture app in-repo (tiny Vite app with login, a modal, a wizard, responsive layout) exercised in CI: init discovery, auth, snap/state/diff/verify/promote round-trips.
- Dogfood acceptance: `uishot feature <x>` against ListForge web returns correct shots < 2s warm; ListForge commits the first real manifest; ListForge skills (adversarial-review, ui-implement) updated to reach for uishot instead of raw Playwright.

## v1 scope and non-goals

**In:** everything above, browser surface only.

**Out (explicitly deferred):**
- Mobile/Expo simulator surface (seam reserved).
- MCP server (thin shim over the daemon if ever wanted; CLI is the contract).
- Contact-sheet composites, console/network sidecar files (index.json carries error counts only).
- Visual-regression baseline management (approve/reject workflows, CI gating) — diff is one-level "what changed since last capture," not a VR product.
- Self-healing selectors / AI-repaired recipes — repair is the agent's job, the tool's job is evidence.

## Open questions for planning (not blockers)

- Manifest single-file vs split when screens count grows — decide by ergonomics during implementation.
- `init` route discovery depth: router-convention parsers (TanStack/Next/React Router) vs crawl-only first.
- Daemon idle-shutdown default and staleness heuristics for HMR-heavy dev servers.
