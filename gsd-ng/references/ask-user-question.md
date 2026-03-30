<tool_usage>
CRITICAL: Every user choice in this workflow MUST be made via the AskUserQuestion tool. NEVER write plain-text menus, lettered option lists (a/b/c), or numbered option lists. Presenting choices in plain text bypasses the interactive UI and violates this workflow's contract.

The AskUserQuestion tool accepts a `questions` array. Each question must have:
- `question` (string) — the question text
- `header` (string, max 12 chars) — short label shown above the question
- `multiSelect` (boolean) — true for "select all that apply", false for single choice
- `options` (array of `{label, description}`) — 2-4 choices; "Other" is added automatically, do NOT add it yourself

Example call structure:
```json
{
  "questions": [
    {
      "question": "The question text?",
      "header": "Choose",
      "multiSelect": false,
      "options": [
        { "label": "Option A", "description": "What option A means" },
        { "label": "Option B", "description": "What option B means" }
      ]
    }
  ]
}
```

If the user picks "Other" (free text): follow up as plain text — NOT another AskUserQuestion.
</tool_usage>
