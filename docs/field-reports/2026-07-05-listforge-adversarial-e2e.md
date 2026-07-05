# Field report: adversarial e2e against ListForge — truth core v0.2.0 (2026-07-05)

Heavy adversarial run against the live ListForge stack (real API on :3001, agent-owned vite
on :3050, real Postgres/Redis, two-step auth with rotating refresh cookies). Purpose: prove
the truth-core release on the app class it was built for, and find what still breaks.
~180 captures total: 3 full `all` sweeps (44 targets each), a 23-recipe `verify`, plus
targeted snaps/clip/drift. uishot linked at 0.2.0+progress+nav-retry via workspace symlink.

## Proven (the value case)

1. **The P0 clip class is dead.** `snap / --sizes lg` on the dashboard — the exact scenario
   that shipped clipped evidence in the 2026-06-13 report and needed a manual
   `xl: 1440x2400` config hack — now auto-expands (1440x900 → 1440x959; sm → 390x1374) and
   the activity feed's bottom entry ("3 items created / Jun 12") is fully in frame. No
   flags, no hacks, no config mutation.
2. **Truth flags fire on real defects immediately.** Every one of 42 sweep shots carried
   `1 image(s) failed to load` — a systemic broken image in the app shell that nobody had
   noticed (plus one screen with a second broken image, plus a real console error on the
   dashboard). This is the warning system paying for itself on day one: the *app* is what's
   broken, and every capture says so.
3. **Near-miss suggestions diagnose real failures precisely.** Typo probe
   `[data-testid=filter-btn]` → `Near matches: button "Filter"` with live URL + title.
   And on the genuine sweep failures (below), the near-match output proved the elements
   exist — pointing straight at responsive visibility as the cause.
4. **Auth held under stress.** Two back-to-back full sweeps (~88 captures) against
   rotating-refresh-token auth: **zero login bounces, zero rotation races, zero 429s.**
   The nav-lock + single-flight re-auth machinery works at real load.
5. **Progress contract works end-to-end.** Cold start narrated daemon spawn → session
   login → per-capture progress on stderr; stdout stayed a pure path list throughout.
6. **`verify` and `drift` earn their keep on a real repo.** verify replayed 23 recipes in
   3:29; drift found 62 uncovered routes and printed pasteable manifest YAML for them.

## Found and fixed in this session

- **Transient nav timeouts under sweep load were false FAILs.** One `page.goto: Timeout
  30000ms` per sweep (different screens each time; every one passed in isolation) — the
  dev-server transform backlog, not app or manifest rot. Fixed: the executor now retries a
  goto timeout once (`retrying navigation to <route> after a timeout` on stderr); other nav
  errors still fail straight through. Covered by fake-surface unit tests. Sweep 3 after the
  fix: zero transient failures.

## Found, not yet fixed at time of writing — ALL RESOLVED same day (see Resolution below)

1. **`verify` misses viewport-conditional recipe rot.** `home/user-menu-open` and
   `items/filter-after-journey` pass verify but fail in sweeps at 390x844 — their `text=`
   targets are hidden at sm (near-match shows the element exists). Sweeps rebuild state per
   viewport; verify replays once at the default viewport. Fix direction: verify should
   replay each state at every viewport it will be captured at (or at minimum the smallest).
   These two are also genuine ListForge manifest bugs — recipes should use sm-safe anchors.
2. **Actionability detail in failure messages.** When a failed selector's element exists
   but isn't visible/clickable (the case above), say so explicitly ("element exists but is
   not visible at 390x844") instead of only implying it via the near-match.
3. **Warm snaps are 7–8s on a real dev stack, not the ~1–2s of the fixture.** Dominated by
   fresh navigation + `networkidle` (10s cap; real SPAs poll) + settle. Honest number for
   the README; optimization candidate: when a screen has `readyWhen`, prefer
   readyWhen + mutation-quiet over full networkidle after the nav-lock's refresh window.

## Environment notes

- `scripts/dev-set-lan-ip.sh` had to run first (machine IP changed; `.env` pointed at a
  stale LAN IP and the wrapper's port probe failed against it). Symptom in the wrapper is
  "vite failed to listen" even though vite is up — worth a hint in the wrapper.
- The two remaining sweep failures produce stuck-shot evidence + near matches + re-record
  commands; repairing them is a manifest edit in ListForge, deliberately left to a
  ListForge-side change.

## Resolution (same day, v0.3.0)

- **Backlog #1 fixed in uishot:** `verify` now replays every named state at every capture
  viewport; sm-only rot fails verify with `(at 390x844)` context. On its first real run it
  caught a *third* case the old verify had blessed (`tasks` readyWhen anchored on the
  desktop-only sidebar).
- **Backlog #2 fixed in uishot:** failure context now distinguishes wrong-selector from
  exists-but-hidden: `The selector matches 1 element(s), but not visible at 390x844`.
- **Backlog #3 fixed in docs:** README/skills now state honest warm-capture timings
  (~1–2s fast pages, 5–8s heavy dev servers).
- **ListForge manifest bugs fixed** (committed in list-forge-monorepo): user-menu recipe
  → `[data-tour=user-menu]`; bulk Clear → new `data-testid=bulk-clear-selection` (label is
  `hidden sm:inline`); tasks readyWhen → breakpoint-safe search-input anchor.
- **New app bug surfaced by the fix:** the old tasks readyWhen proved the sidebar shell,
  masking that the "Ready to Publish" queue renders empty for every dev org despite a
  non-zero badge. State retired with re-record instructions; bug handed off ListForge-side
  (along with the systemic broken image found by the truth flags).
- **Final revalidation (v0.3.0 via workspace link):** `verify` 24/24 green at all
  viewports (2:04); `uishot all` **48/48 captures, 0 failures** (2:18), every shot
  honestly carrying the app's broken-image flag. npm publish of 0.3.0 remains blocked on
  registry credentials; shipped as git tag `uishot@0.3.0` on GitHub.
