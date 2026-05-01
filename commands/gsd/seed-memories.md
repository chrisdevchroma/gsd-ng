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


Detect workspace topology (submodule, monorepo, standalone) and seed appropriate structure-hazard memories into the active runtime's memory directory. Updates both the project rules file (`CLAUDE.md` for Claude, `.github/copilot-instructions.md` for Copilot) and the memory index (`MEMORY.md`) underneath that memory directory.

This skill is re-runnable; runtime topology may have changed since install. All runtime-divergent paths are detected fresh at skill-execution time (Step 5 below) — the skill does NOT rely on install-time template variables.

**Steps:**
1. Run `node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" detect-workspace` to determine workspace type.
2. **Skip detection** (skip if `--force` flag is set):
   Before seeding each template, check for keyword overlap with existing memory files in the active runtime's memory directory (Claude: `.claude/memory/*.md`; Copilot: `.github/memory/*.md`):
   - For the `multi-boundary` template: scan each existing memory file body for the keywords "submodule", "boundary", "commit". If any single memory file contains 2 or more of these keywords, skip seeding this template.
   - Print advisory when skipping: "Found existing memory covering [template concept]: [matching-filename] — skipping [template-name]. Use --force to overwrite."
   - If no overlap is detected, proceed to seed the template normally.
   - Future templates should define their own keyword sets following this same pattern.
3. If type is `submodule` or `monorepo`: seed the multi-boundary memory template from `$HOME/.claude/gsd-ng/templates/memory-templates/multi-boundary.md` into `{memory-dir}/project_commit-boundary.md` where `{memory-dir}` is the runtime-detected directory from Step 5.
4. If type is `standalone`: no memories to seed (report "standalone workspace, no structural memories needed").
5. **Detect the active runtime and target paths (skill-execution time).**

   Check workspace topology:
   - If `.claude/` directory exists at workspace root → runtime is Claude.
   - If `.github/copilot-instructions.md` exists at workspace root → runtime is Copilot.
   - If both exist, prefer the runtime that owns the active session (consult `.planning/config.json` `runtime:` field).

   Per detected runtime, use the correct paths:

   | Runtime | Project rules file                  | Memory directory  | Section style                                                                  |
   |---------|--------------------------------------|-------------------|--------------------------------------------------------------------------------|
   | Claude  | `CLAUDE.md`                          | `.claude/memory/` | Top-level Markdown headings (`## GSD`, `## Memories`)                          |
   | Copilot | `.github/copilot-instructions.md`    | `.github/memory/` | Inside `<!-- GSD Configuration -->` / `<!-- /GSD Configuration -->` markers    |

   Scan the runtime's memory directory (`.claude/memory/*.md` for Claude, `.github/memory/*.md` for Copilot) and regenerate the project rules file's Memories section (append if file exists, create if not). Also write/update the `## GSD` metadata section above the Memories section using the workspace type from Step 1:
   - For non-standalone workspaces: `## GSD\n\n**Workspace type:** {type}\n**Detection signal:** {signal}`
   - For standalone workspaces: `## GSD\n\n**Workspace type:** standalone`
   - **Heading-based (Claude):** If the project rules file already has a `## GSD` section, replace it in-place. If not, insert it before the `## Memories` section.
   - **Marker-based (Copilot):** Write the GSD + Memories content inside the `<!-- GSD Configuration -->` / `<!-- /GSD Configuration -->` marker pair using insert/replace-in-place logic. If the markers are absent, append the marker block at end of file. This preserves existing non-GSD content in `.github/copilot-instructions.md`.
6. Regenerate `MEMORY.md` inside the detected memory directory from the current memory files.
7. Commit changes using the detected project rules file as the updated file.

**If `--force` flag:** Skip confirmation, bypass skip detection, and overwrite existing memory files even if existing memories already cover the concept.
**Otherwise:** Show what would be seeded and ask user to confirm via {{USER_QUESTION_TOOL}} before writing.

Run from: `/gsd:seed-memories`
