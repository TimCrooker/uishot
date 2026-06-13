# Field report: real-world uishot usage — ListForge activity-timeline (2026-06-13)

A working agent (Claude) used uishot hard to capture **real-world E2E evidence** for a
ListForge feature: the home "activity feed" redesign (chronological adjacency grouping +
attribution), rendered by the worktree web client against an **isolated worktree API**
(separate port + Redis DB) serving real account data. This is the first heavy, adversarial,
non-toy use of uishot against a production-shaped SPA with auth and a real backend.

It worked — the evidence shot was captured and shipped to the PR. But several real frictions
surfaced. This doc records what worked (so we don't regress it) and a prioritized fix list,
each grounded in the actual code.

Versions in play: `uishot` / `uishot-core` / `uishot-daemon` / `uishot-skills` @ `0.1.0`.

---

## What worked well (keep — do not regress)

These are the things that made uishot the right tool and should be protected by any change below:

- **`APP_URL` host derived from `VITE_API_URL`** (in the ListForge `uishot.sh` wrapper) so the
  web instance and API are same-host → the refresh cookie survives. This single design choice
  is what let me **capture against an isolated backend**: I pointed the worktree web `.env`
  `VITE_API_URL` at a custom API port (`:3012`) and uishot Just Worked, authed, and captured
  real data flowing through unreleased backend code. This is a killer capability — see
  "Validated patterns" below.
- **The login recipe** (`email → submit → waitFor password → password → submit → waitFor
  sidebar`) was robust against a real two-step auth.
- **`parallelism: 1`** with the inline comment about refresh-cookie rotation racing — correct
  defensive default; I'd have hit flakiness without it.
- **`--json` returns the full capture record** (path, `consoleErrors`, `gitSha`). Exactly what
  an agent needs to locate the artifact and gate on quality.
- **`consoleErrors` surfaced per shot.** My expand-state capture reported `consoleErrors: 1`,
  which is a real signal I could act on. Great that it's first-class.
- **Named viewports + states + features**, plus the `snap <route>` ad-hoc path alongside
  manifest screens. The addressable model is good.

---

## Findings & fixes (prioritized)

### P0 — `fullPage` capture silently clips apps with inner-scroll containers

**Symptom.** Capturing the dashboard route at `lg` (1440×900) clipped the activity feed at the
bottom of the page — the exact content I needed. It looked like a viewport-only capture even
though I expected full-page.

**Root cause.** `packages/daemon/src/browser-surface.ts:299` hardcodes
`page.screenshot({ fullPage: true })`. That captures the **document** height. But
production SPAs (ListForge included) lock the app shell to the viewport (`h-screen` + an inner
`overflow-y:auto` main column). The document is ~viewport-height; the content scrolls **inside
a nested container**. So `fullPage` faithfully captures the viewport-height shell and clips
everything the inner container scrolls past. This is not a ListForge quirk — it's the dominant
layout pattern for dashboards, mail clients, chat apps, admin panels.

**Why it's P0.** `fullPage` is the implicit contract ("you get the whole screen"), and it
silently breaks for a huge class of real apps with no error and no hint. Agents will trust the
shot and ship clipped evidence.

**Workaround I used.** Added a tall named viewport (`xl: 1440x2400`) to grow the shell so the
inner content fit, then reverted the config. Hacky and required mutating a tracked file.

**Proposed fixes (any one closes the gap; (a) is the cleanest):**
- **(a) `--clip <selector>` element capture.** `locator.screenshot()` scrolls the element into
  view (including inner scroll) and captures its full box regardless of ancestor overflow.
  This is the surgical answer for "capture this card/region" and sidesteps the whole
  document-vs-container problem. Add a `clip:` recipe step + `--clip` flag.
- **(b) Scrollable-container-aware full capture.** Before screenshot, detect the deepest
  scrollable element under the ready target and either (i) temporarily neutralize its
  `overflow`/`height` so the document grows, then `fullPage`, or (ii) scroll-stitch it.
- **(c) Ad-hoc viewport height** (see P1) as the low-effort escape hatch.

---

### P1 — `--sizes` only accepts manifest-named viewports; no ad-hoc `WIDTHxHEIGHT`

**Symptom.** To capture taller, I had to **edit the checked-in `uishot.config.yaml`** to add a
viewport, run the snap, then revert. An agent shouldn't mutate a tracked config to take a
one-off shot.

**Root cause.** `--sizes` resolves names against the manifest
(`packages/core/src/manifest.ts:150-154`; schema at `:37` enforces `WIDTHxHEIGHT` *in the YAML
only*). `packages/cli/src/commands/snap.ts:16-44` has no arbitrary-size flag.

**Fix.** Accept inline dims in `--sizes` (or a new `--size`): `--size 1440x2400` →
`{ name: '1440x2400', width, height }` without touching the manifest. The parsing already
exists in `manifest.ts`; just allow the CLI to construct an unnamed `Viewport`.

---

### P1 — no custom output path; artifacts are discover-only

**Symptom.** After capture I had to *find* the PNG (`.uishot/shots/<screen>/<state>@<size>.png`)
and copy it to my evidence dir. `--json` returns the path (good), but I can't tell uishot where
to write.

**Root cause.** Path is constructed and fixed in `packages/core/src/shots.ts:21-26`; no override
in `snap.ts`.

**Fix.** Add `--out <path>` (file or dir). When set, write there (and still report it in
`--json`). Saves every agent a find-and-copy dance and makes captures addressable for
downstream steps (PR upload, diffing, attaching).

---

### P1 — session file is not a portable auth artifact

**Symptom.** I tried to reuse `.uishot/sessions/default.json` (a Playwright `storageState`) in
my own Playwright script to drive a custom scroll/clip capture. It loaded but **did not
authenticate** — the app bounced/relogged because the access token wasn't restored.

**Root cause.** `browser-surface.ts:73-74` saves `ctx.storageState(...)` after the recipe, which
captures cookies + origins/localStorage *as they were at save time*. ListForge keeps the access
token in memory and re-derives it from the refresh cookie on boot; the saved `storageState`
isn't a self-sufficient auth bundle for a cold external context. (Net: the recipe is the real
source of truth, not the file.)

**Why it matters.** Agents will reasonably assume the session file = "logged-in state I can hand
to any Playwright." When it isn't, they waste a cycle (I did). Two options:
- **Document it** explicitly: "the session file is a uishot-internal cache, not a portable auth
  state; to drive the page yourself, replay the recipe."
- **Or make it portable**: after the recipe, capture `storageState` *and* note that
  app-bootstrapped state may be required — or expose a `uishot session export` that hands back a
  context the app will accept. (Lower priority than just documenting the caveat.)

The cleaner long-term answer is P0(a) `--clip`, which removes the reason I reached for an
external script at all.

---

### P2 — silent during daemon + browser boot

**Symptom.** First `snap` of a session was slow (daemon spawn + chromium cold start) with **zero
output** until the final JSON. As an agent I polled the process table and the shots dir to know
whether it was alive, hung, or done.

**Root cause.** `packages/cli/src/output.ts:9-24` emits only the terminal result; the client waits
up to 10s for the daemon (`packages/daemon/src/client.ts:40-52`) silently; the daemon's only line
is `"uishot daemon listening…"` (`bin.ts:9`).

**Fix.** Emit coarse progress to **stderr** (keeps `--json` stdout clean): e.g.
`booting daemon…`, `launching browser…`, `session login…`, `capturing sm…`, `capturing lg…`.
Cheap, and it turns "is it stuck?" guessing into a glance. Gate behind a `--quiet` if needed.

---

### P2 — `--do` has no page-scroll / no eval; `scrollTo` doesn't reposition a `fullPage` capture

**Symptom.** I tried `--do "click:text=3 items created"` to expand+scroll into view, but the
capture still showed the top of the page (because of P0: `fullPage` of a viewport-height shell).

**Root cause.** `packages/core/src/do-parser.ts:7` vocabulary is
`goto, click, fill, select, hover, press, scrollTo, waitFor, waitMs, storage`. `scrollTo:<sel>`
maps to `scrollIntoViewIfNeeded` (`browser-surface.ts` `act`), which scrolls the **inner
container** — but the screenshot is `fullPage` of the **document**, so the scroll doesn't change
what's captured. There's no `eval:`/`scroll:` (intentional minimalism, which is fine).

**Fix.** Mostly subsumed by P0. If P0(a) `--clip` lands, `scrollTo` + `clip` on a selector gives
full control. No need to add `eval:`.

---

## Validated patterns worth documenting (these are wins)

1. **Capture against an isolated / unreleased backend.** Point the agent-owned web instance's
   `VITE_API_URL` at a throwaway API (own port + own Redis DB index) running a feature branch,
   and uishot captures **real data flowing through unmerged backend code**. This is how I proved
   a full-stack feature (new backend field → shared view-model → web render) end-to-end before
   merge. Worth a first-class "capture against a feature-branch backend" recipe in the docs/skill,
   including the same-host `APP_URL` requirement for the auth cookie.
2. **`consoleErrors` as a gate.** Encourage agents to fail/flag a capture with `consoleErrors > 0`.
   It caught a real error in my expanded-state shot.
3. **`--json` path → downstream.** The returned `path` + `gitSha` are exactly enough to attach a
   capture to a PR with provenance.

---

## Suggested order of work

1. **P0(a) `--clip <selector>` element capture** — highest leverage; fixes the clipping class and
   removes the need for external Playwright + tall-viewport hacks.
2. **P1 `--size WIDTHxHEIGHT` ad-hoc** and **P1 `--out <path>`** — small, high-frequency
   ergonomics wins; stop agents mutating tracked config and hunting for files.
3. **P1 session-file caveat docs** (one paragraph) — cheap, prevents a known wasted cycle.
4. **P2 stderr progress** — quality-of-life for long first captures.

---

## Appendix — exact session repro (for reference)

- App: ListForge web (Vite SPA, TanStack Router), dashboard route `/`, activity feed at the
  bottom inside an inner-scroll main column.
- Backend: isolated worktree NestJS API on `:3012`, Redis `db 7` (queues isolated from the dev
  worker), real dev Postgres data.
- Commands used:
  - `uishot.sh snap / --json` → `base@1440x900.png` (activity clipped — P0)
  - `uishot.sh snap / --do "click:text=3 items created" --json` → still top-of-page (P0/P2)
  - Added `xl: 1440x2400` viewport + a `home` state `activity-expanded` (`click: "text=3 items
    created"`), then `snap home --state activity-expanded --sizes xl` → full dashboard with the
    expanded action-group in frame (the shot I shipped). Reverted the config afterward (P1).
