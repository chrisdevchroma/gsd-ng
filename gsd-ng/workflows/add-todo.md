<purpose>
Capture an idea, task, or issue that surfaces during a GSD session as a structured todo for later work. Enables "thought → capture → continue" flow without losing context.
</purpose>

@~/.claude/gsd-ng/references/ask-user-question.md

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="init_context">
Load todo context:

```bash
INIT=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init todos)
if ! node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" guard init-valid "$INIT" 2>/dev/null; then
  INIT=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init todos)
  if ! node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" guard init-valid "$INIT"; then
    echo "Error: init failed twice. Check gsd-tools installation."
    exit 1
  fi
fi
```

Extract from init JSON: `commit_docs`, `date`, `timestamp`, `todo_count`, `todos`, `pending_dir`, `todos_dir_exists`.

Ensure directories exist:
```bash
mkdir -p .planning/todos/pending .planning/todos/completed
```

Note existing areas from the todos array for consistency in infer_area step.
</step>

<step name="extract_content">
**With arguments:** Use as the title/focus.
- `{{COMMAND_PREFIX}}add-todo Add auth token refresh` → title = "Add auth token refresh"

**Without arguments:** Analyze recent conversation to extract:
- The specific problem, idea, or task discussed
- Relevant file paths mentioned
- Technical details (error messages, line numbers, constraints)

Formulate:
- `title`: 3-10 word descriptive title (action verb preferred)
- `problem`: What's wrong or why this is needed
- `solution`: Approach hints or "TBD" if just an idea
- `files`: Relevant paths with line numbers from conversation
</step>

<step name="infer_area">
Infer area from file paths:

| Path pattern | Area |
|--------------|------|
| `src/api/*`, `api/*` | `api` |
| `src/components/*`, `src/ui/*` | `ui` |
| `src/auth/*`, `auth/*` | `auth` |
| `src/db/*`, `database/*` | `database` |
| `tests/*`, `__tests__/*` | `testing` |
| `docs/*` | `docs` |
| `.planning/*` | `planning` |
| `scripts/*`, `bin/*` | `tooling` |
| No files or unclear | `general` |

Use existing area from step 2 if similar match exists.
</step>

<step name="check_duplicates">
```bash
# Search for key words from title in existing todos
grep -l -i "[key words from title]" .planning/todos/pending/*.md 2>/dev/null
```

If potential duplicate found:
1. Read the existing todo
2. Compare scope

If overlapping, use AskUserQuestion:
```
AskUserQuestion(
  header: "Duplicate?",
  question: "Similar todo exists: [title]. What would you like to do?",
  multiSelect: false,
  options: [
    { label: "Skip", description: "Keep existing todo" },
    { label: "Replace", description: "Update existing with new context" },
    { label: "Add anyway", description: "Create as separate todo" },
    { label: "Link as related", description: "Create new todo and link both as related" }
  ]
)
```

Handle responses:
- **"Skip"**: Do not create new todo. Exit workflow.
- **"Replace"**: Update the existing todo file with new context. Exit workflow.
- **"Add anyway"**: Continue to `create_file` step as normal.
- **"Link as related"**: Set `LINK_AS_RELATED=true` and `EXISTING_TODO_FOR_LINK="[existing-todo-filename]"` (basename only, e.g. `2026-03-29-auth-refresh.md`). Continue to `create_file` step.

Note: If "Link as related" was selected, `$LINK_AS_RELATED` is set to `true` and `$EXISTING_TODO_FOR_LINK` holds the existing todo filename. The auto-backlink runs in the `git_commit` step after `create_file`.
</step>

<step name="create_file">
Use values from init context: `timestamp` and `date` are already available.

Generate slug for the title:
```bash
slug=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" generate-slug "$title")
```

Write to `.planning/todos/pending/${date}-${slug}.md`:

```markdown
---
created: [timestamp]
title: [title]
area: [area]
files:
  - [file:lines]
# Optional — for recurring reminders:
# recurring: true
# interval: 30d
---

## Problem

[problem description - enough context for future Claude to understand weeks later]

## Solution

[approach hints or "TBD"]
```

**Recurring todos:** If the user specifies this should be a recurring or permanent reminder, add `recurring: true` and `interval: {duration}` to the frontmatter (uncomment and fill those fields). Valid interval formats: `7d`, `14d`, `30d`, `90d` (any Nd/Nw/Nm/Ny format — d=days, w=weeks, m=months, y=years). Do NOT add `last_completed` — it will be set automatically on first completion. Recurring todos stay in `pending/` after completion and resurface when their interval elapses.

The `--recurring` and `--interval` flags are recognized when invoking via arguments:
- `{{COMMAND_PREFIX}}add-todo Check upstream changes --recurring --interval 30d`
</step>

<step name="update_state">
If `.planning/STATE.md` exists:

1. Use `todo_count` from init context (or re-run `init todos` if count changed)
2. Update "### Pending Todos" under "## Accumulated Context"
</step>

<step name="git_commit">
**If `$LINK_AS_RELATED` is true**, run the auto-backlink BEFORE committing:

```bash
# NEW_TODO_FILE is the filename just created (e.g., "2026-03-29-my-new-todo.md")
# EXISTING_TODO_FOR_LINK is the similar todo found during duplicate check (basename only)

# Append to related: on the new todo (creates the array if missing)
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" frontmatter array-append \
  ".planning/todos/pending/$NEW_TODO_FILE" --field related --value "$EXISTING_TODO_FOR_LINK"

# Append to related: on the existing todo (dedupe-aware; coerces scalar/missing to array)
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" frontmatter array-append \
  ".planning/todos/pending/$EXISTING_TODO_FOR_LINK" --field related --value "$NEW_TODO_FILE"
```

Log: `Linked: $NEW_TODO_FILE <-> $EXISTING_TODO_FOR_LINK`

Commit the todo, any updated state, and (if linking) the existing todo:

```bash
if [[ "$LINK_AS_RELATED" == "true" ]]; then
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" commit "docs: capture todo - [title] (linked to $EXISTING_TODO_FOR_LINK)" \
    --files ".planning/todos/pending/$NEW_TODO_FILE" ".planning/todos/pending/$EXISTING_TODO_FOR_LINK" .planning/STATE.md
else
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" commit "docs: capture todo - [title]" --files .planning/todos/pending/[filename] .planning/STATE.md
fi
```

Tool respects `commit_docs` config and gitignore automatically.

Confirm: "Committed: docs: capture todo - [title]"
</step>

<step name="confirm">
Display the saved todo summary:

```
Todo saved: .planning/todos/pending/[filename]

  [title]
  Area: [area]
  Files: [count] referenced
```

Then use AskUserQuestion:
- header: "Todo saved"
- question: "[title] captured. What would you like to do next?"
- options:
  - "Continue with current work" -- return to what you were doing; exit workflow
  - "Add another todo" -- capture another todo now
  - "View all todos" -- run {{COMMAND_PREFIX}}check-todos

If user selects "Add another todo": loop back to the `extract_content` step within this same workflow invocation (do NOT invoke a fresh {{COMMAND_PREFIX}}add-todo).
If user selects "View all todos": invoke {{COMMAND_PREFIX}}check-todos (the workflow reference, not inline summary).
If user selects "Continue with current work": exit the workflow.
</step>

</process>

<success_criteria>
- [ ] Directory structure exists
- [ ] Todo file created with valid frontmatter
- [ ] Problem section has enough context for future Claude
- [ ] No duplicates (checked and resolved)
- [ ] Area consistent with existing todos
- [ ] STATE.md updated if exists
- [ ] Todo and state committed to git
</success_criteria>
