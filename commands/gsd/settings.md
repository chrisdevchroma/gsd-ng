---
name: gsd:settings
description: Configure GSD workflow toggles and model profile
allowed-tools:
  - Read
  - Write
  - Bash
  - AskUserQuestion
---

<objective>
Interactive configuration of GSD workflow agents and model profile via multi-question prompt.

Routes to the settings workflow which handles:
- Config existence ensuring
- Current settings reading and parsing
- Interactive 5-question prompt (model, research, plan_check, verifier, branching)
- Config merging and writing
- Confirmation display with quick command references
</objective>

<execution_context>
@~/.claude/gsd-ng/workflows/settings.md
</execution_context>

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
**Follow the settings workflow** from `@~/.claude/gsd-ng/workflows/settings.md`.

The workflow handles all logic including:
1. Config file creation with defaults if missing
2. Current config reading
3. Interactive settings presentation with pre-selection
4. Answer parsing and config merging
5. File writing
6. Confirmation display
</process>
