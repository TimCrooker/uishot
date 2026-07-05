---
'uishot-daemon': minor
'uishot': minor
---

Progress streaming: long phases narrate to stderr instead of sitting silent.

The daemon streams `{ id, progress }` frames before the terminal response (`opening session "default"…`, `capturing items.list/base@lg`); the CLI prints them to stderr, plus a `starting uishot daemon…` notice on cold spawn. stdout remains a pure path list. Also documents the session-file caveat: `.uishot/sessions/*.json` is an internal cache, not a portable Playwright auth bundle.
