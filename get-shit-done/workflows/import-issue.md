<purpose>
Import external issues from GitHub/GitLab/Forgejo/Gitea as GSD todos. Supports both single issue import and bulk import filtered by label or milestone.
</purpose>

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

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="detect_platform">
Detect configured platform:

```bash
PLATFORM=$(node "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/get-shit-done/bin/gsd-tools.cjs" detect-platform --raw)
```

Parse JSON. If platform unavailable or CLI not installed, display warning and exit (same as sync-issues):
```
Issue tracker import requires a platform CLI tool.

Platform detected: {platform || 'none'}
CLI installed: {cli_installed}
{If cli_install_url: "Install: {cli_install_url}"}

Configure platform via /gsd:settings or install the CLI tool.
```
</step>

<step name="choose_mode">
Use AskUserQuestion:
- header: "Import Mode"
- question: "How would you like to import issues?"
- options:
  - "Single issue" — import one issue by number
  - "Bulk import" — filter by label and/or milestone
</step>

<step name="single_import">
If single issue mode:

Ask for issue number:
- "Enter the issue number to import (e.g., 42):"

```bash
RESULT=$(node "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/get-shit-done/bin/gsd-tools.cjs" issue-import {platform} {number} --raw)
```

Parse JSON for `imported`, `todo_file`, `title`, `external_ref`, `commented`.

Display result:
```
Imported: {title}
Todo file: {todo_file}
External ref: {external_ref}
Comment posted: {yes/no}
```
</step>

<step name="bulk_import">
If bulk import mode:

Ask for filters:
- "Filter by label (leave empty for all):"
- "Filter by milestone (leave empty for all):"
- "Maximum issues to import (default: 50):"

List matching issues first using the platform CLI directly:
```bash
# For GitHub:
gh issue list --json number,title,state,labels --label "{label}" --milestone "{milestone}" --limit {limit}
# For GitLab:
glab issue list --label "{label}" --milestone "{milestone}" --per-page {limit} --output json
# For Forgejo/Gitea:
fj issue list --label "{label}" --milestone "{milestone}" --limit {limit}
```

Display matching issues as a numbered list. Use AskUserQuestion to confirm:
- header: "Import Confirmation"
- question: "Import these {N} issues as GSD todos?"
- options:
  - "Yes, import all" — import all listed issues
  - "Select specific issues" — enter comma-separated issue numbers to import
  - "Cancel" — abort import

For each selected issue, call:
```bash
node "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/get-shit-done/bin/gsd-tools.cjs" issue-import {platform} {number} --raw
```

Collect results and display summary.
</step>

<step name="summary">
```
## Import Complete

Imported: {N} issues as GSD todos
Skipped: {M}

| # | Title | Todo File | External Ref |
|---|-------|-----------|-------------|
| 1 | Fix auth | 2026-03-18-fix-auth.md | github:#42 |

Next: /gsd:check-todos to review imported items
```
</step>

</process>

<success_criteria>
- [ ] Platform detected and CLI available
- [ ] Single or bulk import mode selected
- [ ] Issues fetched from external tracker
- [ ] Todos created with external_ref frontmatter
- [ ] Import results displayed
</success_criteria>
