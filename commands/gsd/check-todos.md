---
name: gsd:check-todos
description: List pending todos and select one to work on
argument-hint: [area filter]
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---


<objective>
List all pending todos, allow selection, load full context for the selected todo, and route to appropriate action.

Routes to the check-todos workflow which handles:
- Todo data gathering via CLI (list-todos, recurring-due)
- Interactive display and selection
- Full context loading with file summaries
- Roadmap correlation checking
- Action routing (debug, quick task, plan phase, work now, brainstorm, create phase)
- STATE.md updates and git commits
</objective>

<execution_context>
@~/.claude/gsd-ng/workflows/check-todos.md
</execution_context>

<context>
Arguments: $ARGUMENTS (optional area filter)

Todo state and roadmap correlation are loaded in-workflow using `list-todos` and `recurring-due` CLI calls.
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
**Follow the check-todos workflow** from `@~/.claude/gsd-ng/workflows/check-todos.md`.

The workflow handles all logic including:
1. CLI data gathering (list-todos for pending, recurring-due for reminders)
2. Interactive display and selection
3. Full context loading with file summaries
4. Roadmap correlation checking
5. Action offering and execution
6. STATE.md updates
7. Git commits
</process>
