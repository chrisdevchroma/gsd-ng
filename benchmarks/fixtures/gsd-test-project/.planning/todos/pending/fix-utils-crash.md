---
title: Fix parseConfig crash on empty input
area: bug
phase: 3
priority: high
created: 2026-01-14
---

`parseConfig('')` throws `SyntaxError: Unexpected end of JSON input`. Needs a guard clause to return default config for empty/null/malformed input.
