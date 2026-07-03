# Truth core: captures that are never silently wrong (v0.2.0)

**Date:** 2026-07-03
**Status:** approved for implementation (user directive: maximize reliability/bulletproofing)

## Problem

uishot's product is *visual truth for agents*. Today the capture path screenshots whatever
pixels exist the instant a recipe finishes. Four ways it hands an agent a wrong picture or a
dead-end error, all observed in real use (see field report 2026-06-13):

1. **Half-rendered shots.** No settling before capture: pending fonts, undecoded images,
   in-flight DOM mutations (skeletons → content) all race the screenshot. `readyWhen` proves
   one element exists, not that the page finished becoming itself.
2. **Clipped content (the P0 class).** Default `fullPage: true` captures document height.
   Production SPAs lock the shell to the viewport and scroll inside a nested container, so the
   capture silently drops everything below the fold of the inner scroller. `--clip` (0.1.1) is
   an opt-in workaround, not a fix: agents don't know they need it until after they've trusted
   a clipped shot.
3. **No verdict.** A shot that captured mid-animation, with broken images, or with clipped
   content looks identical (in the record) to a perfect one. `consoleErrors` is the only
   quality signal.
4. **Dumb failures.** A failed selector reports the selector and Playwright's first error line.
   The agent learns nothing about what *is* on the page and burns a cycle re-driving the
   browser to look.

## Design principle

> A uishot capture is either trustworthy or explicitly flagged — never silently wrong.
> A uishot failure is a repair prompt, not a dead end.

## Components

### 1. Settled capture (daemon: `browser-surface.ts`)

Before every screenshot, run a bounded settle pass in the page:

- Double `requestAnimationFrame` tick (flush pending paint).
- `document.fonts.ready` (capped).
- All `<img>` elements decoded or errored; count failures.
- DOM mutation quiet window: MutationObserver, quiet for `QUIET_MS` (200ms), capped at
  `SETTLE_TIMEOUT_MS` (3000ms). Timeout ⇒ warning `layout still mutating after 3000ms`,
  capture proceeds.

Returns `{ settled: boolean; failedImages: number }`. Runs for full-page and clip captures,
and for the stuck-state evidence shot (best-effort there).

No new config. Constants live in the daemon; revisit only if real apps need tuning.

### 2. Clip-proof full capture (daemon: `browser-surface.ts`)

After settle, detect inner-scroll clipping and neutralize it:

- **Detect:** elements (excluding `html`/`body`, whose overflow `fullPage` already handles)
  with `scrollHeight − clientHeight > 100px` and scrollable overflow-y. Keep the top few by
  hidden pixels.
- **Expand:** save inline styles, then set `height: auto; max-height: none; overflow: visible`
  on each scroll container **and every ancestor** up to `<body>` (viewport-locked shells chain
  `height: 100%`/`100vh` constraints). The document grows to content height; `fullPage`
  now truthfully captures everything. Restore inline styles after the screenshot.
- **Guards:**
  - *Virtualization:* after expanding, re-measure across a double-rAF tick. If content height
    is still growing (windowed list rendering more rows) or the expansion mutated the DOM
    beyond a sane bound, restore immediately and fall back to the normal capture **plus
    warning** `content clipped: ~Npx hidden inside <container>; use --clip or a taller size`.
  - *Height cap:* final document height capped at `MAX_CAPTURE_HEIGHT` (10000px). Beyond it,
    capture the cap and warn `content truncated at 10000px`.
- **`--clip` path:** if the clip target itself hides overflow, the same expand technique
  applies to it before `locator.screenshot()`, so a clipped element capture is also complete.

Fixed/sticky elements render once at their natural position in the grown document — the
capture is content-complete, which is the contract; pixel-parity with a scrolled viewport is
not a goal.

### 3. Capture verdict (core + daemon + CLI)

- `CapturedImage` gains `warnings: string[]`.
- `ShotRecord` gains optional `warnings?: string[]` (omitted when empty — index stays clean).
- Warning sources: settle timeout, failed images (`2 image(s) failed to load`), clipped
  content fallback, height cap.
- **Output contract preserved:** stdout remains one path per line. Warnings print to
  **stderr** as `warning <screen>/<state>@<size>: <text>`. `--json` carries them
  structurally. Exit code unchanged (a flagged shot is still a shot); agents gate on the
  field, humans see stderr.

### 4. Failure intelligence (core: `suggest.ts`; daemon: `browser-surface.ts`)

When an `act` step with a selector fails:

- Append page context to the error: current URL and `<title>`.
- Harvest candidates from the live DOM (bounded, timeout-capped, best-effort):
  all `data-testid` values, plus visible `button`/`a`/`[role]` accessible text (first ~200).
- Score candidates against identifier tokens extracted from the failed selector (pure
  function in core: token overlap + bigram similarity), return top 3 above a floor.
- Error becomes, e.g.:
  `step click [data-testid=refund] failed: timeout 10000ms. Page: /orders/42 ("Orders — Acme"). Near matches: [data-testid=refund-button], [data-testid=refund-modal], button "Refund order"`

Suggestion harvesting must never mask the original failure: any error inside it is swallowed.

## Out of scope (explicitly)

- Streaming progress from the daemon (P2; protocol change, separate effort).
- Self-healing manifests (auto-editing YAML on selector rot) — `verify` + better errors first.
- Scroll-stitch capture for virtualized lists — detection + honest warning is the v0.2 answer.
- `uishot map` / `uishot pr` — different initiative (adoption, not truth).

## Testing

New demo-app fixtures + daemon tests (real Chromium against the Vite fixture server):

- `feed.html` — viewport-locked shell, inner scroller with tall content and a
  `data-testid=feed-end` sentinel. Assert default capture height ≫ viewport height and
  no clipped-content warning (i.e., expansion worked).
- `virtual.html` — scroller that appends rows on scroll/resize (windowing simulation).
  Assert fallback: viewport-ish capture **with** clipped-content warning.
- `slow.html` — content that mutates for ~700ms then settles + one 404 image. Assert capture
  waits (sentinel content present in record semantics via no unsettled warning) and
  `1 image(s) failed to load` warning.
- `restless.html` — mutates forever. Assert `layout still mutating` warning arrives within
  the cap (test runtime bounded).
- Near-miss: `click [data-testid=open-filter]` (typo) on `items.html` → error includes
  `open-filters` and the page title.
- Style restoration: after a feed.html capture, assert the scroller still scrolls
  (inline styles restored).
- Core unit tests for the suggestion scorer (exact-ish match ranks first, junk excluded).

Existing tests must pass unchanged except where they gain `warnings` assertions.

## Release

Minor version: 0.2.0 (`uishot-core`, `uishot-daemon`, `uishot` CLI, `uishot-skills` doc
update). Changeset: "Captures are never silently wrong: settled capture, inner-scroll-aware
full capture, per-shot warnings, near-miss selector suggestions on failure."
