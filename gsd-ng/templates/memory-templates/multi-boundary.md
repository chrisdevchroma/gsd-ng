---
name: Commit in the correct code boundary
description: This repo has multiple code boundaries — commit changes in the right sub-directory
type: feedback
---

This repository has multiple code boundaries (submodules or workspace packages).
When making code changes, always commit within the correct sub-directory — not in the root.

**Why:** Commits at the wrong level confuse git history and may not reach the intended package's history.
**How to apply:** Before committing, verify your CWD is inside the correct sub-directory for the code you changed.
