---
"uishot": minor
---

feat(cli): add `uishot qa` command — one-shot QA sweep with classification and reporting

New command collapses the three-script QA pipeline (`uishot all --diff` →
qa-parse-uishot.py → qa-file-issues.py) into a single call.

Flags:
- `--threshold <ratio>` — pixel-diff sensitivity (default 0.02)
- `--report summary|detailed|github` — output format
- `--since-last` — diff against prior QA run
- `--json` — structured JSON findings
- `--feature <tag>` — targeted sweep
- `--sizes <names>` — comma-separated viewport names

Output modes:
- `summary` (default): compact markdown with emoji-severity indicators
- `detailed`: full JSON findings
- `github`: issue-body templates for `gh issue create`

Persists `.uishot/qa-state.json` for baseline comparisons across runs.
