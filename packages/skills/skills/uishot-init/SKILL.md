---
name: uishot-init
description: Use when setting up uishot in a repo for the first time, or when uishot.config.yaml has no/few screens — guides discovering routes, building the auth session, and seeding named states.
---

# uishot-init — first-time pairing

`uishot init` already scaffolded uishot.config.yaml and discovered what it could mechanically. Your job is the judgment half:

1. **Base URL.** Find the dev server URL (existing .env, README, dev scripts). Put `${APP_URL}`-style env refs in the manifest, never literal URLs.
2. **Auth session.** Find the login route + working dev credentials (ask the user if not discoverable). Encode either a `recipe` (fill/click/waitFor against the login form) or an `inject` (localStorage/cookie token from env vars). Validate: `uishot doctor`.
3. **Screens.** For each major route: id (`feature.name` convention), route, `feature` tag, `readyWhen` (a selector proving real render, not a spinner). Param routes need a representative id baked into the route (e.g. `/items/42`) — pick a stable seed row, note it in a YAML comment.
4. **Seed states.** For each screen, walk it with `uishot snap <screen> --do ...` and promote the states that matter: every modal, each wizard step, key empty/filled form variants. Promote only what someone would revisit.
5. **Prove the loop.** `uishot feature <tag>` must return correct shots warm in a few seconds each. `uishot verify` must pass clean. Commit the manifest.
