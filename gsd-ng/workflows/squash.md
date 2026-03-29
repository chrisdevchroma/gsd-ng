<purpose>
Squash phase commits into clean history for code review and merge requests.
Supports three strategies: single (all commits to one), per-plan (group by plan),
and logical (user-guided grouping). Always creates backup tags before rewriting history.
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
@~/.claude/gsd-ng/references/planning-config.md
</required_reading>

<process>

<step name="parse_arguments">
Parse command arguments:
- Phase number (required unless --list-backup-tags)
- `--strategy single|per-plan|logical` (required for squash)
- `--dry-run` show plan without executing
- `--allow-stable` allow squash on main/master/develop
- `--list-backup-tags` list existing backup tags
- `--force-push` push result with --force-with-lease after squash

Parse the ARGUMENTS variable for phase number and flags.

If `--list-backup-tags`:
```bash
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" squash --list-backup-tags
```
Display results and STOP.
</step>

<step name="detect_phase">
Load phase context:

```bash
INIT=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init execute-phase "${PHASE}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Extract PHASE_NUMBER, PHASE_NAME, PHASE_SLUG, TARGET_BRANCH, REMOTE from init JSON.
</step>

<step name="detect_workspace">
Detect the workspace topology so git operations target the correct repository. When workspace type is 'submodule', git operations (push, branch) must target the submodule directory so they operate against the correct repository and remote.

```bash
WORKSPACE_JSON=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" detect-workspace 2>/dev/null || echo '{"type":"standalone","signal":null,"submodule_paths":[]}')
WORKSPACE_TYPE=$(node -e "try{const w=JSON.parse(process.argv[1]);process.stdout.write(w.type||'standalone')}catch{process.stdout.write('standalone')}" "$WORKSPACE_JSON")
SUBMODULE_PATH=$(node -e "try{const w=JSON.parse(process.argv[1]);const p=w.submodule_paths||[];process.stdout.write(p[0]||'')}catch{process.stdout.write('')}" "$WORKSPACE_JSON")
```

When WORKSPACE_TYPE is "submodule" and SUBMODULE_PATH is non-empty:
```bash
if [ "$WORKSPACE_TYPE" = "submodule" ] && [ -n "$SUBMODULE_PATH" ]; then
  # Override REMOTE from the submodule's git context
  REMOTE=$(git -C "$SUBMODULE_PATH" remote | head -1)
  GIT_PREFIX="git -C $SUBMODULE_PATH"
else
  GIT_PREFIX="git"
fi
```
</step>

<step name="select_strategy">
If --strategy flag provided, use it.

Otherwise, present the three strategies with AskUserQuestion:

```
Squash Strategy:
- **single**: All phase commits into one clean commit
- **per-plan**: Group commits by plan (one commit per plan)
- **logical**: Interactive — you choose how to group commits

Recommended: 'single' for small phases, 'per-plan' for multi-plan phases
```

AskUserQuestion with options: "single", "per-plan", "logical"
</step>

<step name="dry_run_preview">
Always show dry run first:

```bash
PREVIEW=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" squash ${PHASE} --strategy ${STRATEGY} --dry-run)
if [[ "$PREVIEW" == @file:* ]]; then PREVIEW=$(cat "${PREVIEW#@file:}"); fi
```

Display the preview showing which commits will be grouped and what messages will be used.

For 'logical' strategy: present the commit list and ask the user to specify groupings before proceeding. Parse user groupings, then use 'single' strategy applied to each group.

Ask confirmation:
```
Ready to squash? This rewrites git history.
A backup tag will be created before any changes.
(yes / abort)
```

If "abort": STOP.
</step>

<step name="execute_squash">
Execute the squash:

```bash
RESULT=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" squash ${PHASE} --strategy ${STRATEGY} ${ALLOW_STABLE_FLAG})
if [[ "$RESULT" == @file:* ]]; then RESULT=$(cat "${RESULT#@file:}"); fi
```

Display the result including backup tag name.
</step>

<step name="offer_push">
If `--force-push` flag was provided, or ask:

```
Push squashed branch with --force-with-lease?
(yes / no)
```

If yes:
```bash
# REMOTE already resolved in detect_phase + detect_workspace steps
BRANCH=$($GIT_PREFIX branch --show-current)
$GIT_PREFIX push --force-with-lease "$REMOTE" "$BRANCH"
```
</step>

<step name="summary">
Display result:

```
GSD > SQUASH COMPLETE

Phase:    ${PHASE_NUMBER} - ${PHASE_NAME}
Strategy: ${STRATEGY}
Backup:   ${BACKUP_TAG}
Branch:   ${CURRENT_BRANCH}

Restore:  git reset --hard ${BACKUP_TAG}
Cleanup:  git tag -d ${BACKUP_TAG}
```
</step>

</process>

<success_criteria>
- [ ] Strategy selected (single, per-plan, or logical)
- [ ] Dry run preview shown before execution
- [ ] Backup tag created before any history rewrite
- [ ] Squash executed with correct strategy
- [ ] --force-with-lease used for push (never bare --force)
- [ ] Restore command displayed for safety
- [ ] Submodule workspace detected and push targets submodule remote
</success_criteria>
