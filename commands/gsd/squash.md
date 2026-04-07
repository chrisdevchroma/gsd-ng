---
name: gsd:squash
description: Squash phase commits into clean history for code review
argument-hint: "<phase> [--strategy single|per-plan|logical] [--dry-run] [--allow-stable]"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---


<objective>
Squash phase commits into clean history for code review.

Supports three strategies:
- **single**: All phase commits into one clean commit
- **per-plan**: Group commits by plan (one commit per plan)
- **logical**: Interactive — you choose how to group commits

Always creates a backup tag before rewriting history.
Use --dry-run to preview groupings without executing.
</objective>

<execution_context>
@~/.claude/gsd-ng/workflows/squash.md
</execution_context>

<context>
$ARGUMENTS
</context>

<tool_usage>
CRITICAL: You MUST use the {{USER_QUESTION_TOOL}} tool for ALL user choices in this workflow. NEVER output plain-text menus, lettered lists (a/b/c), or numbered option lists. Every decision point requires a real {{USER_QUESTION_TOOL}} tool call with the questions parameter.

The {{USER_QUESTION_TOOL}} tool schema:
```json
{
  "questions": [
    {
      "question": "The question text",
      "header": "Short label (max 12 chars)",
      "multiSelect": false,
      "options": [
        { "label": "Option label", "description": "What this option means" }
      ]
    }
  ]
}
```

Key constraints:
- header: max 12 characters (abbreviate if needed)
- options: 2-4 items; "Other" is added automatically by the tool — do NOT add it yourself
- multiSelect: true for "select all that apply", false for "pick one"
- If user picks "Other" (free text): follow up as plain text, not another {{USER_QUESTION_TOOL}}
</tool_usage>

<process>
Execute the squash workflow from @~/.claude/gsd-ng/workflows/squash.md end-to-end.
Pass $ARGUMENTS for phase number and flags.
</process>
