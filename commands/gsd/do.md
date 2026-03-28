---
name: gsd:do
description: Route freeform text to the right GSD command automatically
argument-hint: "<description of what you want to do>"
allowed-tools:
  - Read
  - Bash
  - AskUserQuestion
---
<objective>
Analyze freeform natural language input and dispatch to the most appropriate GSD command.

Acts as a smart dispatcher — never does the work itself. Matches intent to the best GSD command using routing rules, confirms the match, then hands off.

Use when you know what you want but don't know which `/gsd:*` command to run.
</objective>

<execution_context>
@~/.claude/gsd-ng/workflows/do.md
@~/.claude/gsd-ng/references/ui-brand.md
</execution_context>

<context>
$ARGUMENTS
</context>

<tool_usage>
CRITICAL: You MUST use the AskUserQuestion tool for ALL user choices in this workflow. NEVER output plain-text menus, lettered lists (a/b/c), or numbered option lists. Every decision point requires a real AskUserQuestion tool call with the questions parameter.

The AskUserQuestion tool schema:
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
- If user picks "Other" (free text): follow up as plain text, not another AskUserQuestion
</tool_usage>

<process>
Execute the do workflow from @~/.claude/gsd-ng/workflows/do.md end-to-end.
Route user intent to the best GSD command and invoke it.
</process>
