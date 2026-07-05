# uishot-skills

## 0.2.0

### Minor Changes

- 324a488: Truth core: captures are never silently wrong.

  - **Settled capture** — every screenshot waits (capped 3s) for fonts, image decode, and a 200ms DOM-mutation-quiet window; pages still mutating at the cap flag the shot instead of lying.
  - **Clip-proof full capture** — clipped inner-scroll containers (the viewport-locked SPA shell pattern) are detected and expanded so `fullPage` truthfully holds all content, then restored. Virtualized lists that grow when expanded get an honest clipped-content warning; content past 10000px is truncated with a warning. `--clip` targets get the same expansion.
  - **Per-shot warnings** — `warnings` on capture records (`--json`) and `warning <screen>/<state>@<size>: ...` lines on stderr; stdout stays a pure path list.
  - **Failure intelligence** — failed recipe steps now report the page URL/title and near-miss selector suggestions harvested from the live DOM (`Near matches: [data-testid=open-filters], ...`).

## 0.1.0

### Minor Changes

- Initial public release: warm-daemon screenshot engine, manifest-addressable screens/states, `snap`/`sweep`/`verify`/`drift`/`promote` CLI, agent skills shipped via `uishot init`.
