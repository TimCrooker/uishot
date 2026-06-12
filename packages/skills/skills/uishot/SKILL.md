---
name: uishot
description: Use when iterating on web UI — capture any screen/state at any viewport in ~1s via `uishot snap` instead of driving a browser. Also when adding screens/states to uishot.config.yaml, diagnosing recipe failures, or running visual diffs.
---

# uishot — instant UI screenshots

The loop: edit code → (HMR applies it) → `uishot snap <screen> [--state s] [--sizes sm,lg]` → Read the printed PNG paths → edit again. Never boot Playwright yourself; the daemon is already warm.

## Commands

- `uishot list` — what's addressable (screens, states, features)
- `uishot snap <screen|/route>` — capture; `--state <name>` for a named state; `--sizes sm,lg`; `--session admin`
- `uishot snap <screen> --do "click:[data-testid=x]" --do "waitFor:[role=dialog]"` — compose a state ad hoc
- `uishot promote <screen> --name <state>` — persist the last --do chain as a named state. ALWAYS promote a state you'll revisit.
- `uishot diff <screen>` — capture + % changed vs previous capture + .diff.png
- `uishot feature <tag>` / `uishot all` — sweeps
- `uishot verify` — replay all recipes, find rot
- `uishot doctor` — when anything is weird (auth, dev server, daemon); `--reauth` to force fresh sessions

## Rules

- stdout is file paths. Read ONLY the sizes you need; don't read every size of every shot.
- A failed recipe prints stuck-state evidence (`__failed-*.png`) — Read it; it shows where the recipe stopped. Then fix the recipe in uishot.config.yaml or re-record with --do + promote.
- Selectors in recipes: prefer data-testid, then ARIA roles/ids. Never nth-child chains.
- `--do` values cannot contain `=` (parser splits on last `=`); use a named YAML state for those.
- New screen you're building? Add it to uishot.config.yaml (screens.<id>: route, feature, readyWhen) BEFORE iterating, so it's addressable for the rest of the session and for the next agent.
- If a state needs >5 recipe steps, the app should expose it more directly (deep-linkable URL, query param) — suggest that to the user instead of writing a long recipe.
