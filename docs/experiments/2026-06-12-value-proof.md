# Value-proof experiment: uishot vs status-quo Playwright driving

**Date:** 2026-06-12
**Question:** For an agent doing real visual UI work, does uishot materially reduce token cost and wall-clock time at equal-or-better task success, versus the agent driving Playwright itself?

## Method

Paired A/B: 3 tasks × 2 arms = 6 fresh agent runs, sequential, same model, same live dev stack (ListForge web, vite :3050 + dev API). Working tree restored to clean between runs. Agents are not told they are in an experiment.

- **Arm A (uishot):** prompt includes the uishot workflow (the shipped skill) + manifest already configured. No Playwright guidance.
- **Arm B (status quo):** identical prompt except tooling: "verify visually with Playwright" (installed and available). Arm B gets the same fair environment docs: app URL, creds location, two-step login description, auth throttle warning. For B runs the uishot manifest/skills are moved out of the repo so the environment is status-quo-faithful.

Run order alternates (B,A / A,B / B,A) to balance environment drift.

## Tasks

| | Type | Seeded change | Prompt (same for both arms) |
|---|---|---|---|
| T1 | Responsive defect | `StatusChipFilter.tsx`: remove `flex-wrap`, add `whitespace-nowrap` → chip row overflows at 390px | "Users report the My Items page (/items) is broken on phones. Find and fix it. Done = visually verified fixed at 390x844 and still correct at 1440x900." |
| T2 | Overlay defect | `FilterDrawer.tsx`: popover `w-[300px]` → `w-[640px]` → clips off-screen at mobile | "The Filter popover on /items looks broken on small screens. Find and fix. Done = popover correct at 390x844 with no desktop regression. You must open the popover to see it." |
| T3 | Greenfield visual | none | "Restyle the items-page no-results state (search for gibberish): centered, lucide icon, friendlier copy. Done = visually verified at both sizes." |

All three require *looking* to succeed — the property under test.

## Metrics (per run)

- **Success** (primary): fixed rubric judged on evidence screenshots captured neutrally by the orchestrator after each run (defect gone at sm, no lg regression, change shipped). Judge sees screenshots only.
- **Wall-clock** (agent dispatch → return)
- **Total tokens** (harness-reported per agent run)
- **Tool calls**, **screenshots produced**
- **Time-to-first-pixel:** elapsed/calls until the agent first sees the target state rendered

## Validity notes

- N=3 pairs is directional, not statistical; a consistent multi-X spread across all pairs is decision-grade for tooling, nothing more.
- uishot does not reduce the cost of *reading* images, only of *producing the right ones*; expected savings come from eliminated auth/navigation/scripting roundtrips and instant multi-size/state addressing.
- Arm B is deliberately well-informed (creds, login shape, throttle warning) — this measures tooling, not documentation quality.

## Results

(to be filled by the run)
