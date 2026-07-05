# uishot

## 0.2.0

### Minor Changes

- 324a488: Truth core: captures are never silently wrong.

  - **Settled capture** — every screenshot waits (capped 3s) for fonts, image decode, and a 200ms DOM-mutation-quiet window; pages still mutating at the cap flag the shot instead of lying.
  - **Clip-proof full capture** — clipped inner-scroll containers (the viewport-locked SPA shell pattern) are detected and expanded so `fullPage` truthfully holds all content, then restored. Virtualized lists that grow when expanded get an honest clipped-content warning; content past 10000px is truncated with a warning. `--clip` targets get the same expansion.
  - **Per-shot warnings** — `warnings` on capture records (`--json`) and `warning <screen>/<state>@<size>: ...` lines on stderr; stdout stays a pure path list.
  - **Failure intelligence** — failed recipe steps now report the page URL/title and near-miss selector suggestions harvested from the live DOM (`Near matches: [data-testid=open-filters], ...`).

### Patch Changes

- Updated dependencies [324a488]
  - uishot-core@0.2.0
  - uishot-daemon@0.2.0
  - uishot-skills@0.2.0

## 0.1.1

### Patch Changes

- snap: three capture ergonomics from real-world ListForge usage (see
  docs/field-reports/2026-06-13-listforge-activity-timeline.md):

  - `--clip <selector>` captures a single element instead of the full page. Fixes the
    common case where `fullPage` only sees a viewport-height app shell because the content
    scrolls inside a nested `overflow` container (dashboards, mail/chat layouts).
  - `--sizes` now accepts inline `WIDTHxHEIGHT` (e.g. `--sizes 1440x2400`) alongside named
    viewports — no need to edit the tracked manifest for a one-off tall/odd capture.
  - `--out <path>` writes a capture to a custom `.png` file or directory instead of
    `.uishot/shots` (and stays out of the index / diff baseline).

- Updated dependencies
  - uishot-core@0.1.1
  - uishot-daemon@0.1.1

## 0.1.0

### Minor Changes

- Initial public release: warm-daemon screenshot engine, manifest-addressable screens/states, `snap`/`sweep`/`verify`/`drift`/`promote` CLI, agent skills shipped via `uishot init`.

### Patch Changes

- Updated dependencies
  - uishot-core@0.1.0
  - uishot-daemon@0.1.0
  - uishot-skills@0.1.0
