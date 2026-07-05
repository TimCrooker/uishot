# uishot

**Instant, addressable UI screenshots for AI agents.**

Agents are slow at iterating on real UI: boot a browser, re-discover auth, re-discover routes, drive page by page, screenshot, load, repeat. uishot replaces that loop with one command against an always-warm daemon:

```bash
uishot snap orders.detail --state refund-modal --sizes sm,lg
# .uishot/shots/orders.detail/refund-modal@390x844.png
# .uishot/shots/orders.detail/refund-modal@1440x900.png
```

Warm captures take ~1–2s on a fast page — on a heavy dev server (cold vite transforms, polling SPAs that never go network-idle) expect 5–8s, still with zero auth or navigation work. The agent's loop becomes: **edit → HMR → snap → Read image → edit**.

## The idea: addressable, not exhaustive

Screenshotting "every possible state" is combinatorially impossible. uishot makes any state an agent cares about **nameable once, reproducible forever**, in three tiers:

1. **Route states** — a URL + viewport. `uishot snap items.list`
2. **Named states** — small deterministic action recipes in a checked-in manifest, recorded once, replayed in milliseconds. `uishot snap orders.detail --state refund-modal`
3. **Ad-hoc states** — composed inline while iterating, promoted to named states when worth keeping:

```bash
uishot snap orders.detail --do "click:[data-testid=refund]" --do "waitFor:[role=dialog]"
uishot promote orders.detail --name refund-modal   # now it's tier 2, forever
```

The manifest (`uishot.config.yaml`) is the durable knowledge: routes, auth, recipes, feature boundaries. Agents seed it once and maintain it incrementally — nothing is ever re-figured out.

## Install

```bash
pnpm add -D uishot        # or npm/yarn
npx playwright install chromium
npx uishot init           # scaffold manifest, discover routes, install agent skills
```

`init` also installs two agent skills (`.claude/skills/`, `.agents/skills/`) so any coding agent immediately knows the workflow.

## Manifest reference

```yaml
app:
  baseUrl: ${APP_URL} # env-resolved; uishot fails loudly if unset
  defaultSizes: [sm, lg]

viewports:
  sm: 390x844
  md: 768x1024
  lg: 1440x900

sessions:
  default:
    loginRoute: /login
    recipe: # action recipe against the login form...
      - fill: ["#email", "${UISHOT_EMAIL}"]
      - fill: ["#password", "${UISHOT_PASSWORD}"]
      - click: "button[type=submit]"
      - waitFor: "[data-testid=app-shell]"
  admin: # ...or direct token injection
    inject:
      localStorage:
        token: ${ADMIN_TOKEN}
      cookies:
        - { name: session, value: "${ADMIN_SESSION}" }

screens:
  items.list:
    route: /items
    feature: items # enables `uishot feature items`
    readyWhen: "[data-testid=items-table]" # proves real render, not a spinner
    session: default # optional; defaults to "default"
    states:
      filters-open:
        - click: "[data-testid=open-filters]"
        - waitFor: "[role=dialog]"
```

**Step vocabulary** (intentionally tiny): `goto`, `click`, `fill`, `select`, `hover`, `press`, `scrollTo`, `waitFor`, `waitMs` (capped at 5000ms, discouraged), `storage` (seed a localStorage key — pair with a `goto` so the app boots from it; the deterministic answer to persisted UI state like remembered-open panels, where a toggle-click would flip an unknown baseline). If a state needs more than ~5 steps, the app should expose it more directly (deep-linkable URL).

`${VAR}` anywhere in the manifest resolves from the environment at run time. Auth state is cached per session (`.uishot/sessions/`); a login-bounce triggers one automatic re-auth and retry.

## CLI

```
uishot init                                # scaffold + route discovery + skills install
uishot snap <screen|/route> [--state s] [--do "click:sel"]... [--sizes sm,lg] [--session admin] [--diff] [--json]
uishot feature <tag>                       # all screens+states in a feature, parallel
uishot all                                 # full sweep
uishot diff <screen> [--state] [--sizes]   # capture + % changed vs previous + .diff.png
uishot promote <screen> --name <state>     # persist the last --do chain as a named state
uishot list [--feature tag] [--json]       # everything addressable
uishot verify [--feature tag]              # replay all recipes, report rot (CI-able)
uishot drift [--strict] [--json]           # diff manifest vs codebase routes (CI-able)
uishot doctor [--reauth]                   # manifest/dev-server/browser/daemon/session health
uishot daemon <status|stop>                # lifecycle (normally automatic)
```

**Output contract:** stdout is one produced file path per line (the minimal payload an agent needs). Paths are stable and guessable: `.uishot/shots/<screen>/<state>@<WxH>.png`. `--json` returns the full record (timestamps, git SHA, console-error counts, warnings, change ratios). `.uishot/shots/index.json` accumulates the latest record per screen/state/size.

**Progress contract:** long phases narrate to stderr (`starting uishot daemon…`, `opening session "default"…`, `capturing items.list/base@lg`), so a cold start is never a silent hang. stdout stays a pure path list.

**Truth contract:** a shot is either trustworthy or explicitly flagged — never silently wrong. Every capture waits for the page to settle (fonts, image decode, a DOM-mutation-quiet window, capped at 3s), and anything less than fully trustworthy is flagged: `warning <screen>/<state>@<size>: ...` on stderr, `warnings: [...]` in `--json`. Flags cover pages still mutating at the cap, broken images, and clipped or truncated content. No warnings means: full content, settled.

**Failure contract:** a broken recipe exits 1 and writes stuck-state evidence — a screenshot of exactly where the recipe stopped (`__failed-<state>@<size>.png`) plus the failing step, the page URL/title it was on, near-miss selector suggestions harvested from the live DOM (`Near matches: [data-testid=open-filters], ...`), and the exact commands to repair. Errors are prompts.

## Keeping the manifest in line as the app evolves

The manifest only pays off if it stays true. Two commands cover the two ways it rots, and both are CI-able:

- **`uishot drift`** — coverage rot. Re-discovers the route tree and diffs it against the manifest: routes nobody made addressable (printed as a pasteable `screens:` snippet), param routes needing a representative id, and screens pointing at deleted routes. `--strict` exits 1 for CI.
- **`uishot verify`** — recipe rot. Replays every session recipe, `readyWhen`, and named state headlessly without taking screenshots — states replay at every capture viewport, so a recipe that only works at desktop widths fails here, not in your evidence. A renamed `data-testid` shows up with stuck-state evidence and near-miss suggestions.

The working agreement for an agent (also shipped as the `uishot` skill):

1. **Adding a route?** Add its screen in the same change. `uishot drift` is the reviewer.
2. **Building a modal/wizard/panel?** Compose it with `--do`, then `promote` it — future sessions get it for free.
3. **Renaming selectors?** Run `uishot verify` before you're done; fix the recipes your rename broke.
4. **CI:** `uishot drift --strict && uishot verify` keeps both axes honest on every PR.

## How it stays honest

Production SPAs lock the app shell to the viewport and scroll inside a nested container — the layout of dashboards, mail clients, chat apps, admin panels. A naive full-page screenshot captures the viewport-height shell and silently drops everything the inner container scrolls past. uishot detects clipped scroll containers before every capture, temporarily grows them (and the ancestor chains constraining them) so the document truthfully holds all content, screenshots, and restores the page. Two honest edges:

- **Virtualized/windowed lists** render more rows to fill any space they're given — there is no true bottom. uishot detects the growth, backs off, and flags the shot: `content clipped: ~2200px hidden inside main[data-testid=feed] ... use --clip on a smaller region or a taller size`.
- **Extremely tall content** is truncated at 10000px with a warning, so a shot can't blow out an agent's context window.

`--clip <selector>` element captures get the same expansion, so clipping a scrollable region also yields its full content.

## How it stays fast

A per-project daemon (autostarted by the first CLI call, idle-shutdown after 30 min) keeps a headless Chromium with authed contexts warm. Capture jobs fan out across parallel pages for feature/all sweeps. The manifest reloads fresh on every job, so agent edits apply with zero restarts.

## FAQ

- **Selector rot?** `uishot verify` replays every recipe headlessly — run it in CI. Prefer `data-testid` and role selectors in recipes.
- **Sweeps die with login bounces after repeated runs?** Two known dynamics with rotating-refresh-token auth: (1) concurrent page boots race the rotation — set `app.parallelism: 1`; (2) every SPA boot hits the app's token-refresh endpoint, and back-to-back full sweeps can trip the API's rate limit on it — raise that limit in your dev environment. uishot serializes boots and self-heals single bounces, but it cannot out-engineer a 429 from your own API.
- **Selectors from test files don't work.** `data-testid`s that only exist in `*.test.tsx` mocks are not in production DOM. Verify selectors against the running app (snap it and look), not the test suite.
- **`=` in a fill value?** The `--do` parser splits on the last `=`; values containing `=` need a named YAML state.
- **Can I reuse `.uishot/sessions/<name>.json` in my own Playwright script?** No — it's a uishot-internal cache (Playwright `storageState` at save time), not a portable auth bundle. Apps that keep access tokens in memory and re-derive them from a refresh cookie won't authenticate a cold external context from it. The session recipe is the source of truth; if you need the state yourself, replay the recipe — or better, use `--clip`/`--do` so you don't need an external script at all.
- **Monorepo?** Run uishot from the app directory that owns the manifest (one manifest per app surface).
- **Native mobile?** v1 is browser-only. Capture targets sit behind a `Surface` interface; a simulator surface is the planned second implementation.

## License

MIT
