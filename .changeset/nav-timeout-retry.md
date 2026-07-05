---
'uishot-daemon': patch
---

Sweep resilience: a transient `page.goto` timeout (dev-server load) now retries once with a `retrying navigation…` progress note instead of failing the target. Non-timeout navigation errors still fail immediately. Eliminated the one-false-FAIL-per-sweep flake class observed in ListForge field testing.
