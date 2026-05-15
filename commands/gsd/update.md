---
name: gsd:update
description: Update GSD to latest version via npm or GitHub Releases fallback
allowed-tools:
  - Bash
  - AskUserQuestion
---


Run the update command in dry-run mode first, then ask for confirmation before executing:

1. Check for updates:
!`node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" update --dry-run`

2. Parse the result:
   - If status is "already_current": tell the user "You're on the latest version (X.Y.Z)." and stop.
   - If status is "ahead": tell the user "You're ahead of the latest release (installed X.Y.Z > latest A.B.C)." and stop.
   - If status is "unknown_version": tell the user "No GSD installation found. Run: npx gsd-ng@latest" and stop.
   - If status is "both_unavailable": tell the user the message from the result and stop.

3. If update_available: show the user "Update available: {installed} -> {latest} (via {update_source})" and warn about clean install (commands/gsd/ and gsd-ng/ will be wiped and replaced; custom files preserved).

4. Use {{USER_QUESTION_TOOL}} to ask "Proceed with update?" with options "Yes, update now" and "Cancel".

5. If confirmed, execute the update by invoking the Bash tool (NOT the `!`backtick form, which runs literally without substitution). Use the `install_type` value from the dry-run JSON in step 1 to pick the flag: `--local` if `install_type` is `"local"`, `--global` if `"global"`. Run:

   `node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" update <flag>`

   where `<flag>` is the resolved `--local` or `--global` (substitute it yourself before calling Bash — do not pass the literal placeholder).

6. Show the result and remind user to restart Claude Code.
