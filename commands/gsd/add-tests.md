---
name: gsd:add-tests
description: Generate tests for a completed phase based on UAT criteria and implementation
argument-hint: "<phase> [additional instructions]"
allowed-tools:
  - Read
  - Write
  - Edit
  - Bash
  - Glob
  - Grep
  - Agent
  - AskUserQuestion
argument-instructions: |
  Parse the argument as a phase number (integer, decimal, or letter-suffix), plus optional free-text instructions.
  Example: /gsd:add-tests 12
  Example: /gsd:add-tests 12 focus on edge cases in the pricing module
---


<objective>
Generate unit and E2E tests for a completed phase, using its SUMMARY.md, CONTEXT.md, and VERIFICATION.md as specifications.

Analyzes implementation files, classifies them into TDD (unit), E2E (browser), or Skip categories, presents a test plan for user approval, then generates tests following RED-GREEN conventions.

Output: Test files committed with message `test(phase-{N}): add unit and E2E tests from add-tests command`
</objective>

<execution_context>
@~/.claude/gsd-ng/workflows/add-tests.md
</execution_context>

<context>
Phase: $ARGUMENTS

@.planning/STATE.md
@.planning/ROADMAP.md
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
Execute the add-tests workflow from @~/.claude/gsd-ng/workflows/add-tests.md end-to-end.
Preserve all workflow gates (classification approval, test plan approval, RED-GREEN verification, gap reporting).
</process>
