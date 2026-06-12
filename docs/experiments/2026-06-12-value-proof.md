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

## Results (run 2026-06-12, 9 agent runs, all on live ListForge web)

| Run | Condition | Arm | Tokens | Tool calls | Wall-clock | Success |
|---|---|---|---|---|---|---|
| T1 | full env docs | B (Playwright) | 77,643 | 21 | 3:39 | PASS |
| T1 | full env docs | A (uishot) | 69,466 | 21 | 3:54 | PASS |
| T2 | full env docs | A (uishot) | 69,683 | 17 | 2:33 | PASS |
| T2 | full env docs | B (Playwright) | 65,283 | 15 | 2:01 | PASS |
| T3 | full env docs | B (Playwright) | 77,476 | 17 | 2:29 | PASS |
| T3 | full env docs | A (uishot) | 77,346 | 17 | 2:17 | PASS |
| T4 | blind (no env docs, no tool pointer) | A* | 73,610 | 18 | 4:05 | PASS |
| T4 | blind (no env docs) | B | 72,454 | 22 | 3:46 | PASS |
| T4 | pointer only ("repo has uishot") | A′ | **67,459** | **13** | **1:42** | PASS |

*A\* had uishot available but was given no pointer; it never discovered it and hand-rolled Playwright — skills must be surfaced to count.*

## Findings

1. **Success was never the differentiator:** 9/9 across both arms. A frontier model fixes these bugs either way.
2. **With a perfect hand-written environment briefing, it's a wash** (±5% tokens, ±10% time). When someone has already written down the login flow, creds location, and rate-limit warnings, a competent agent scripts Playwright cheaply.
3. **In the realistic condition — no hand-holding — uishot wins decisively on iteration speed:** T4-A′ (one-line pointer) vs T4-B (blind): **-55% wall-clock (1:42 vs 3:46), -41% tool calls (13 vs 22), -7% tokens.** The win comes from zero auth/bootstrap work and instant state addressing.
4. **Compounding is real and was captured in-data:** T4-A′ directly reused the `filter-open` state promoted by the T2-A agent two sessions earlier, and produced the most thorough fix of all four popover runs in the least time. Arm B's equivalents (auth scripts, screenshots) lived in /tmp and evaporated. T2-A also flagged pre-existing manifest rot unprompted.
5. **Token deltas are structurally modest:** image reads dominate token spend and both arms read images. The full-docs arms hide a cost off the books — the ~500-token perfect environment briefing per session, plus the requirement that the knowledge exists somewhere at all. The manifest is that knowledge, versioned.
6. **Caveats:** N is small; one seeded-defect family repeated for T4; the `.uishot/sessions` auth state on disk may have aided the blind arms' login bootstrap (biases the comparison AGAINST uishot — real blind sessions would fare worse); single model; tasks were single-screen (multi-screen sweeps and design-review workloads, where addressability multiplies, were not measured).

## Experiment 2: revisit protocol (replicated, the decisive run)

Addressing experiment 1's weaknesses (n=1 cells, first-visit-only tasks): **4 replicates × 2 arms** on a *revisit* task — a design tweak to the Filter popover's section headings, a feature whose `filter-open` state already lives in the manifest (the steady-state condition the product claims to create). Pointer-only prompts (Arm B additionally told where creds live, CLAUDE.md-equivalent). Fresh agent per run, randomized interleaved order (A,B,B,A,B,A,A,B), tree restored between runs, judged on neutral captures. 8/8 PASS, visually equivalent outcomes.

| Replicate | Arm | Tokens | Tool calls | Wall-clock |
|---|---|---|---|---|
| R1 | A | 84,395 | 32 | 4:04 |
| R4 | A | 76,597 | 31 | 3:47 |
| R6 | A | 75,059 | 27 | 3:10 |
| R7 | A | 82,499 | 33 | 3:36 |
| **A mean** | | **79,638** | **30.8** | **3:39** |
| R2 | B | 84,834 | 48 | 7:39 |
| R3 | B | 86,352 | 41 | 6:47 |
| R5 | B | 87,326 | 41 | 6:39 |
| R8 | B | 87,480 | 42 | 6:46 |
| **B mean** | | **86,498** | **43.0** | **6:58** |

**The distributions do not overlap on any metric:**
- **Wall-clock: A 3:10–4:04 vs B 6:39–7:39.** Slowest A beats fastest B by 2.5 minutes. **1.9× faster.** Perfect rank separation at n=4/4 → Mann-Whitney exact p ≈ 0.014.
- **Tool calls: A 27–33 vs B 41–48.** −28%. Same perfect separation.
- **Tokens: A 75.1–84.4k vs B 84.8–87.5k.** −8%, marginally non-overlapping. B's band is strikingly tight — a consistent ~7k fixed overhead (auth+interaction scripting) per session, forever.

Where B's extra ~12 calls / ~3.3 min went, every single time: writing and debugging a login+open-popover Playwright script, scrolled-capture plumbing, and retries — work the manifest had already crystallized for A into `snap items --state filter-open --sizes sm,lg`.

## Conclusion

uishot's measured value is concentrated exactly where the design predicted: **eliminating per-session re-derivation** (auth, navigation, state-reaching) and **compounding addressable states across sessions**. The replicated revisit protocol puts numbers on the steady state: **1.9× faster wall-clock (p ≈ 0.014), −28% tool calls, −8% tokens**, with zero distribution overlap at n=4 per arm — and experiment 1's pointer-vs-blind cell showed the first-visit gap is even larger (−55% wall-clock). It is not a token-compression device; it is an iteration-velocity and knowledge-persistence device. For workloads that touch many screens/states per session (design review, refactor sweeps), the per-state savings multiply — unmeasured here, but the mechanism is the proven part.
