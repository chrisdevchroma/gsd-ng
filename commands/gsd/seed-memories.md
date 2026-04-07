---
description: Detect workspace topology and seed appropriate guardrail memories
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - Glob
  - Grep
  - Agent
argument-hint: "[--force]"
---


Detect workspace topology (submodule, monorepo, standalone) and seed appropriate structure-hazard memories into `.claude/memory/`. Updates both CLAUDE.md Memories section and `.claude/memory/MEMORY.md`.

**Steps:**
1. Run `node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" detect-workspace` to determine workspace type
2. **Skip detection** (skip if `--force` flag is set):
   Before seeding each template, check for keyword overlap with existing `.claude/memory/*.md` files:
   - For the `multi-boundary` template: scan each existing memory file body for the keywords "submodule", "boundary", "commit". If any single memory file contains 2 or more of these keywords, skip seeding this template.
   - Print advisory when skipping: "Found existing memory covering [template concept]: [matching-filename] — skipping [template-name]. Use --force to overwrite."
   - If no overlap is detected, proceed to seed the template normally.
   - Future templates should define their own keyword sets following this same pattern.
3. If type is `submodule` or `monorepo`: seed the multi-boundary memory template from `$HOME/.claude/gsd-ng/templates/memory-templates/multi-boundary.md` into `.claude/memory/project_commit-boundary.md`
4. If type is `standalone`: no memories to seed (report "standalone workspace, no structural memories needed")
5. Scan `.claude/memory/*.md` and regenerate the CLAUDE.md Memories section (append if CLAUDE.md exists, create if not). Also write/update the `## GSD` metadata section above the Memories section using the workspace type from Step 1:
   - For non-standalone workspaces: `## GSD\n\n**Workspace type:** {type}\n**Detection signal:** {signal}`
   - For standalone workspaces: `## GSD\n\n**Workspace type:** standalone`
   - If CLAUDE.md already has a `## GSD` section, replace it in-place. If not, insert it before the `## Memories` section.
6. Regenerate `.claude/memory/MEMORY.md` from current memory files
7. Commit changes

**If `--force` flag:** Skip confirmation, bypass skip detection, and overwrite existing memory files even if existing memories already cover the concept.
**Otherwise:** Show what would be seeded and ask user to confirm via {{USER_QUESTION_TOOL}} before writing.

Run from: `/gsd:seed-memories`
