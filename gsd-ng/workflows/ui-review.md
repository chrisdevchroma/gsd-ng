<purpose>
Retroactive 6-pillar visual audit of implemented frontend code. Standalone command that works on any project — GSD-managed or not. Produces scored UI-REVIEW.md with actionable findings.
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
@~/.claude/gsd-ng/references/ui-brand.md
</required_reading>

<process>

## 0. Initialize

```bash
INIT=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init phase-op "${PHASE_ARG}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Parse: `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `commit_docs`.

```bash
UI_AUDITOR_MODEL=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" resolve-model gsd-ui-auditor --raw)
```

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► UI AUDIT — PHASE {N}: {name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 1. Detect Input State

```bash
SUMMARY_FILES=$(ls "${PHASE_DIR}"/*-SUMMARY.md 2>/dev/null)
UI_SPEC_FILE=$(ls "${PHASE_DIR}"/*-UI-SPEC.md 2>/dev/null | head -1)
UI_REVIEW_FILE=$(ls "${PHASE_DIR}"/*-UI-REVIEW.md 2>/dev/null | head -1)
```

**If `SUMMARY_FILES` empty:** Exit — "Phase {N} not executed. Run /gsd:execute-phase {N} first."

**If `UI_REVIEW_FILE` non-empty:** Use AskUserQuestion:
- header: "Existing UI Review"
- question: "UI-REVIEW.md already exists for Phase {N}."
- options:
  - "Re-audit — run fresh audit"
  - "View — display current review and exit"

If "View": display file, exit.
If "Re-audit": continue.

## 2. Gather Context Paths

Build file list for auditor:
- All SUMMARY.md files in phase dir
- All PLAN.md files in phase dir
- UI-SPEC.md (if exists — audit baseline)
- CONTEXT.md (if exists — locked decisions)

## 3. Spawn gsd-ui-auditor

```
◆ Spawning UI auditor...
```

Build prompt:

```markdown
Read ~/.claude/agents/gsd-ui-auditor.md for instructions.

<objective>
Conduct 6-pillar visual audit of Phase {phase_number}: {phase_name}
{If UI-SPEC exists: "Audit against UI-SPEC.md design contract."}
{If no UI-SPEC: "Audit against abstract 6-pillar standards."}
</objective>

<files_to_read>
- {summary_paths} (Execution summaries)
- {plan_paths} (Execution plans — what was intended)
- {ui_spec_path} (UI Design Contract — audit baseline, if exists)
- {context_path} (User decisions, if exists)
</files_to_read>

<config>
phase_dir: {phase_dir}
padded_phase: {padded_phase}
</config>
```

Omit null file paths.

```
Task(
  prompt=ui_audit_prompt,
  subagent_type="gsd-ui-auditor",
  model="{UI_AUDITOR_MODEL}",
  description="UI Audit Phase {N}"
)
```

## 4. Handle Return

**If `## UI REVIEW COMPLETE`:**

Display score summary:

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► UI AUDIT COMPLETE ✓
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

**Phase {N}: {Name}** — Overall: {score}/24

| Pillar | Score |
|--------|-------|
| Copywriting | {N}/4 |
| Visuals | {N}/4 |
| Color | {N}/4 |
| Typography | {N}/4 |
| Spacing | {N}/4 |
| Experience Design | {N}/4 |

Top fixes:
1. {fix}
2. {fix}
3. {fix}

Full review: {path to UI-REVIEW.md}

───────────────────────────────────────────────────────────────

## ▶ Next

- `/gsd:verify-work {N}` — UAT testing
- `/gsd:plan-phase {N+1}` — plan next phase

<sub>`/clear` first → fresh context window</sub>

───────────────────────────────────────────────────────────────
```

## 5. Commit (if configured)

```bash
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" commit "docs(${padded_phase}): UI audit review" --files "${PHASE_DIR}/${PADDED_PHASE}-UI-REVIEW.md"
```

</process>

<success_criteria>
- [ ] Phase validated
- [ ] SUMMARY.md files found (execution completed)
- [ ] Existing review handled (re-audit/view)
- [ ] gsd-ui-auditor spawned with correct context
- [ ] UI-REVIEW.md created in phase directory
- [ ] Score summary displayed to user
- [ ] Next steps presented
</success_criteria>
