---
name: gsd:create-pr
description: Create a pull request or merge request from GSD work
allowed-tools:
  - Read
  - Write
  - Bash
  - Glob
  - Grep
  - AskUserQuestion
---


<objective>
Create a pull/merge request from the current branch with auto-generated description from phase context.
</objective>

<execution_context>
@~/.claude/gsd-ng/workflows/create-pr.md
</execution_context>

<process>
Execute the create-pr workflow from @~/.claude/gsd-ng/workflows/create-pr.md end-to-end.
</process>
