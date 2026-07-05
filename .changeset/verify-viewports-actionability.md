---
'uishot-daemon': minor
'uishot': minor
'uishot-skills': patch
'uishot-core': patch
---

verify now replays every named state at every capture viewport — a recipe that only works at desktop widths fails verify (`at 390x844` in the message) instead of passing at one viewport and breaking in sweeps. Failure messages also say when a selector matches an element that exists but is not visible at the current viewport, and docs state honest warm-capture timings for heavy dev servers.
