<purpose>
Retroactive 6-pillar visual audit of implemented frontend code. Standalone command that works on any project — GSD-managed or not. Produces scored UI-REVIEW.md with actionable findings.
</purpose>

@~/.claude/gsd-ng/references/ask-user-question.md

<required_reading>
@~/.claude/gsd-ng/references/ui-brand.md
</required_reading>

<process>

## 0. Initialize

```bash
mkdir -p $TMPDIR
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init phase-op "${PHASE_ARG}" > $TMPDIR/ui-review-init.json
if ! node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" guard init-valid-file $TMPDIR/ui-review-init.json 2>/dev/null; then
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init phase-op "${PHASE_ARG}" > $TMPDIR/ui-review-init.json
  if ! node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" guard init-valid-file $TMPDIR/ui-review-init.json; then
    echo "Error: init failed twice. Check gsd-tools installation."
    exit 1
  fi
fi
```

Read `$TMPDIR/ui-review-init.json` and parse: `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`, `commit_docs`.

```bash
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" resolve-model gsd-ui-auditor > $TMPDIR/ui-review-auditor-model.txt
read UI_AUDITOR_MODEL < $TMPDIR/ui-review-auditor-model.txt
```

Display banner:
```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 GSD ► UI AUDIT — PHASE {N}: {name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

## 1. Detect Input State

```bash
mkdir -p $TMPDIR
ls "${PHASE_DIR}"/*-SUMMARY.md 2>/dev/null > $TMPDIR/ui-review-summary-files.txt
SUMMARY_FILES=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  if [ -z "$SUMMARY_FILES" ]; then SUMMARY_FILES="$line"; else SUMMARY_FILES="$SUMMARY_FILES"$'\n'"$line"; fi
done < $TMPDIR/ui-review-summary-files.txt
ls "${PHASE_DIR}"/*-UI-SPEC.md 2>/dev/null | head -1 > $TMPDIR/ui-review-spec-file.txt
read UI_SPEC_FILE < $TMPDIR/ui-review-spec-file.txt || UI_SPEC_FILE=""
ls "${PHASE_DIR}"/*-UI-REVIEW.md 2>/dev/null | head -1 > $TMPDIR/ui-review-review-file.txt
read UI_REVIEW_FILE < $TMPDIR/ui-review-review-file.txt || UI_REVIEW_FILE=""
```

**If `SUMMARY_FILES` empty:** Exit — "Phase {N} not executed. Run {{COMMAND_PREFIX}}execute-phase {N} first."

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

- `{{COMMAND_PREFIX}}verify-work {N}` — UAT testing
- `{{COMMAND_PREFIX}}plan-phase {N+1}` — plan next phase

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
