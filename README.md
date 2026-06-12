# uishot

**Instant, addressable UI screenshots for AI agents.**

Agents are slow at iterating on real UI: boot a browser, re-discover auth, re-discover routes, drive page by page, screenshot, load, repeat. uishot replaces that loop with one command against an always-warm daemon:

```bash
uishot snap orders.detail --state refund-modal --sizes sm,lg
# .uishot/shots/orders.detail/refund-modal@390x844.png
# .uishot/shots/orders.detail/refund-modal@1440x900.png
```

~1–2s warm, any screen, any named state, any viewport. The agent's loop becomes: **edit → HMR → snap → Read image → edit**.

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
uishot doctor [--reauth]                   # manifest/dev-server/browser/daemon/session health
uishot daemon <status|stop>                # lifecycle (normally automatic)
```

**Output contract:** stdout is one produced file path per line (the minimal payload an agent needs). Paths are stable and guessable: `.uishot/shots/<screen>/<state>@<WxH>.png`. `--json` returns the full record (timestamps, git SHA, console-error counts, change ratios). `.uishot/shots/index.json` accumulates the latest record per screen/state/size.

**Failure contract:** a broken recipe exits 1 and writes stuck-state evidence — a screenshot of exactly where the recipe stopped (`__failed-<state>@<size>.png`) plus the failing step and the exact commands to repair. Errors are prompts.

## How it stays fast

A per-project daemon (autostarted by the first CLI call, idle-shutdown after 30 min) keeps a headless Chromium with authed contexts warm. Capture jobs fan out across parallel pages for feature/all sweeps. The manifest reloads fresh on every job, so agent edits apply with zero restarts.

## FAQ

- **Selector rot?** `uishot verify` replays every recipe headlessly — run it in CI. Prefer `data-testid` and role selectors in recipes.
- **Sweeps die with login bounces after repeated runs?** Two known dynamics with rotating-refresh-token auth: (1) concurrent page boots race the rotation — set `app.parallelism: 1`; (2) every SPA boot hits the app's token-refresh endpoint, and back-to-back full sweeps can trip the API's rate limit on it — raise that limit in your dev environment. uishot serializes boots and self-heals single bounces, but it cannot out-engineer a 429 from your own API.
- **Selectors from test files don't work.** `data-testid`s that only exist in `*.test.tsx` mocks are not in production DOM. Verify selectors against the running app (snap it and look), not the test suite.
- **`=` in a fill value?** The `--do` parser splits on the last `=`; values containing `=` need a named YAML state.
- **Monorepo?** Run uishot from the app directory that owns the manifest (one manifest per app surface).
- **Native mobile?** v1 is browser-only. Capture targets sit behind a `Surface` interface; a simulator surface is the planned second implementation.

## License

MIT
