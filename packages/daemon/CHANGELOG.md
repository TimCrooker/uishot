# uishot-daemon

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

## 0.1.0

### Minor Changes

- Initial public release: warm-daemon screenshot engine, manifest-addressable screens/states, `snap`/`sweep`/`verify`/`drift`/`promote` CLI, agent skills shipped via `uishot init`.

### Patch Changes

- Updated dependencies
  - uishot-core@0.1.0
