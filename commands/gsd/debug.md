---
name: gsd:debug
description: Systematic debugging with persistent state across context resets
argument-hint: [issue description]
allowed-tools:
  - Read
  - Bash
  - Agent
  - AskUserQuestion
---


<objective>
Debug issues using scientific method with subagent isolation.

**Orchestrator role:** Gather symptoms, spawn gsd-debugger agent, handle checkpoints, spawn continuations.

**Why subagent:** Investigation burns context fast (reading files, forming hypotheses, testing). Fresh 200k context per investigation. Main context stays lean for user interaction.
</objective>

<context>
User's issue: $ARGUMENTS

Check for active sessions:
```bash
ls .planning/debug/*.md 2>/dev/null | grep -v resolved | head -5
```
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

## 0. Initialize Context

```bash
mkdir -p $TMPDIR
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" state load > $TMPDIR/debug-init.json
```

Extract `commit_docs` from `$TMPDIR/debug-init.json`. Resolve debugger model:
```bash
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" resolve-model gsd-debugger > $TMPDIR/debug-debugger-model.txt
read debugger_model < $TMPDIR/debug-debugger-model.txt
```

## 1. Check Active Sessions

If active sessions exist AND no $ARGUMENTS:
- List sessions with status, hypothesis, next action
- User picks number to resume OR describes new issue

If $ARGUMENTS provided OR user describes new issue:
- Continue to symptom gathering

## 2. Gather Symptoms (if new issue)

Use AskUserQuestion for each:

1. **Expected behavior** - What should happen?
2. **Actual behavior** - What happens instead?
3. **Error messages** - Any errors? (paste or describe)
4. **Timeline** - When did this start? Ever worked?
5. **Reproduction** - How do you trigger it?

After all gathered, confirm ready to investigate.

## 3. Spawn gsd-debugger Agent

Resolve workspace topology, then fill prompt and spawn:

```bash
mkdir -p $TMPDIR
node "./.claude/gsd-ng/bin/gsd-tools.cjs" detect-workspace --field type > $TMPDIR/debug-ws-type.txt
read WORKSPACE_TYPE < $TMPDIR/debug-ws-type.txt
[ -z "$WORKSPACE_TYPE" ] && WORKSPACE_TYPE="standalone"

node "./.claude/gsd-ng/bin/gsd-tools.cjs" detect-workspace --field submodule_paths_summary > $TMPDIR/debug-ws-subs.txt
read SUBMODULE_PATHS < $TMPDIR/debug-ws-subs.txt
[ -z "$SUBMODULE_PATHS" ] && SUBMODULE_PATHS="none"

PROJECT_ROOT="$CLAUDE_PROJECT_DIR"
if [ -z "$PROJECT_ROOT" ]; then
  git rev-parse --show-toplevel > $TMPDIR/debug-root.txt 2>/dev/null || true
  [ -s $TMPDIR/debug-root.txt ] && read PROJECT_ROOT < $TMPDIR/debug-root.txt
  [ -z "$PROJECT_ROOT" ] && PROJECT_ROOT="$PWD"
fi
```

```markdown
<objective>
Investigate issue: {slug}

**Summary:** {trigger}
</objective>

<symptoms>
expected: {expected}
actual: {actual}
errors: {errors}
reproduction: {reproduction}
timeline: {timeline}
</symptoms>

<mode>
symptoms_prefilled: true
goal: find_and_fix
</mode>

<workspace_context>
Workspace type: {WORKSPACE_TYPE}
Project root: {PROJECT_ROOT}
Submodule paths: {SUBMODULE_PATHS}

CRITICAL: Always commit to the source location. Your working directory is {PROJECT_ROOT}.
If workspace type is 'submodule', source code lives in the submodule directories listed above.
Do NOT modify deployed copies (e.g., .claude/gsd-ng/) — always edit source first.
</workspace_context>

<debug_file>
Create: .planning/debug/{slug}.md
</debug_file>
```

```
Agent(
  prompt=filled_prompt,
  subagent_type="gsd-debugger",
  model="{debugger_model}",
  description="Debug {slug}"
)
```

## 4. Handle Agent Return

**If `## ROOT CAUSE FOUND`:**
- Display root cause and evidence summary
- Offer options:
  - "Fix now" - spawn fix subagent
  - "Plan fix" - suggest {{COMMAND_PREFIX}}plan-phase --gaps
  - "Manual fix" - done

**If `## CHECKPOINT REACHED`:**
- Present checkpoint details to user
- Get user response
- If checkpoint type is `human-verify`:
  - If user confirms fixed: continue so agent can finalize/resolve/archive
  - If user reports issues: continue so agent returns to investigation/fixing
- Spawn continuation agent (see step 5)

**If `## INVESTIGATION INCONCLUSIVE`:**
- Show what was checked and eliminated
- Offer options:
  - "Continue investigating" - spawn new agent with additional context
  - "Manual investigation" - done
  - "Add more context" - gather more symptoms, spawn again

## 5. Spawn Continuation Agent (After Checkpoint)

When user responds to checkpoint, spawn fresh agent:

```markdown
<objective>
Continue debugging {slug}. Evidence is in the debug file.
</objective>

<prior_state>
<files_to_read>
- .planning/debug/{slug}.md (Debug session state)
</files_to_read>
</prior_state>

<checkpoint_response>
**Type:** {checkpoint_type}
**Response:** {user_response}
</checkpoint_response>

<mode>
goal: find_and_fix
</mode>
```

```
Agent(
  prompt=continuation_prompt,
  subagent_type="gsd-debugger",
  model="{debugger_model}",
  description="Continue debug {slug}"
)
```

</process>

<success_criteria>
- [ ] Active sessions checked
- [ ] Symptoms gathered (if new)
- [ ] gsd-debugger spawned with context
- [ ] Checkpoints handled correctly
- [ ] Root cause confirmed before fixing
</success_criteria>
