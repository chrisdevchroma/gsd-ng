---
name: gsd:cleanup
description: Archive phase directories from completed milestones
model: haiku
allowed-tools:
  - Bash
  - AskUserQuestion
---

Run the cleanup command in dry-run mode first, show the preview to the user, then ask for confirmation before executing:

1. Show dry-run preview:
!`node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" cleanup --dry-run`

2. If nothing_to_do is true, tell the user "All milestones already archived. Nothing to clean up." and stop.

3. Otherwise, show the preview and use AskUserQuestion to ask "Proceed with archiving?" with options "Yes, archive" and "Cancel".

4. If confirmed, execute:
!`node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" cleanup`

5. Show the result.
