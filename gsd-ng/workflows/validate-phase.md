<purpose>
Audit Nyquist validation gaps for a completed phase. Generate missing tests. Update VALIDATION.md.
</purpose>

@~/.claude/gsd-ng/references/ask-user-question.md

<required_reading>
@~/.claude/gsd-ng/references/ui-brand.md
</required_reading>

<process>

## 0. Initialize

```bash
mkdir -p $TMPDIR
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init phase-op "${PHASE_ARG}" > $TMPDIR/validate-phase-init.json
if ! node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" guard init-valid-file $TMPDIR/validate-phase-init.json 2>/dev/null; then
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init phase-op "${PHASE_ARG}" > $TMPDIR/validate-phase-init.json
  if ! node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" guard init-valid-file $TMPDIR/validate-phase-init.json; then
    echo "Error: init failed twice. Check gsd-tools installation."
    exit 1
  fi
fi
```

Read `$TMPDIR/validate-phase-init.json` and parse: `phase_dir`, `phase_number`, `phase_name`, `phase_slug`, `padded_phase`.

```bash
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" resolve-model gsd-nyquist-auditor > $TMPDIR/validate-phase-auditor-model.txt
read AUDITOR_MODEL < $TMPDIR/validate-phase-auditor-model.txt
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" config-get workflow.nyquist_validation > $TMPDIR/validate-phase-nyquist-cfg.txt
read NYQUIST_CFG < $TMPDIR/validate-phase-nyquist-cfg.txt
```

If `NYQUIST_CFG` is `false`: exit with "Nyquist validation is disabled. Enable via {{COMMAND_PREFIX}}settings."

Display banner: `GSD > VALIDATE PHASE {N}: {name}`

## 1. Detect Input State

```bash
mkdir -p $TMPDIR
ls "${PHASE_DIR}"/*-VALIDATION.md 2>/dev/null | head -1 > $TMPDIR/validate-phase-validation-file.txt
read VALIDATION_FILE < $TMPDIR/validate-phase-validation-file.txt || VALIDATION_FILE=""
ls "${PHASE_DIR}"/*-SUMMARY.md 2>/dev/null > $TMPDIR/validate-phase-summary-files.txt
SUMMARY_FILES=""
while IFS= read -r line; do
  [ -z "$line" ] && continue
  if [ -z "$SUMMARY_FILES" ]; then SUMMARY_FILES="$line"; else SUMMARY_FILES="$SUMMARY_FILES"$'\n'"$line"; fi
done < $TMPDIR/validate-phase-summary-files.txt
```

- **State A** (`VALIDATION_FILE` non-empty): Audit existing
- **State B** (`VALIDATION_FILE` empty, `SUMMARY_FILES` non-empty): Reconstruct from artifacts
- **State C** (`SUMMARY_FILES` empty): Exit — "Phase {N} not executed. Run {{COMMAND_PREFIX}}execute-phase {N} first."

## 2. Discovery

### 2a. Read Phase Artifacts

Read all PLAN and SUMMARY files. Extract: task lists, requirement IDs, key-files changed, verify blocks.

### 2b. Build Requirement-to-Task Map

Per task: `{ task_id, plan_id, wave, requirement_ids, has_automated_command }`

### 2c. Detect Test Infrastructure

State A: Parse from existing VALIDATION.md Test Infrastructure table.
State B: Filesystem scan:

```bash
find . -name "pytest.ini" -o -name "jest.config.*" -o -name "vitest.config.*" -o -name "pyproject.toml" 2>/dev/null | head -10
find . \( -name "*.test.*" -o -name "*.spec.*" -o -name "test_*" \) -not -path "*/node_modules/*" 2>/dev/null | head -40
```

### 2d. Cross-Reference

Match each requirement to existing tests by filename, imports, test descriptions. Record: requirement → test_file → status.

## 3. Gap Analysis

Classify each requirement:

| Status | Criteria |
|--------|----------|
| COVERED | Test exists, targets behavior, runs green |
| PARTIAL | Test exists, failing or incomplete |
| MISSING | No test found |

Build: `{ task_id, requirement, gap_type, suggested_test_path, suggested_command }`

No gaps → skip to Step 6, set `nyquist_compliant: true`.

## 4. Present Gap Plan

Call AskUserQuestion with gap table and options:
1. "Fix all gaps" → Step 5
2. "Skip — mark manual-only" → add to Manual-Only, Step 6
3. "Cancel" → exit

## 5. Spawn gsd-nyquist-auditor

```bash
mkdir -p $TMPDIR
node ./.claude/gsd-ng/bin/gsd-tools.cjs detect-workspace --field type > $TMPDIR/validate-phase-workspace-type.txt
read WORKSPACE_TYPE < $TMPDIR/validate-phase-workspace-type.txt
node ./.claude/gsd-ng/bin/gsd-tools.cjs detect-workspace --field submodule_paths_summary > $TMPDIR/validate-phase-submodule-paths.txt
read SUBMODULE_PATHS < $TMPDIR/validate-phase-submodule-paths.txt
git rev-parse --show-toplevel 2>/dev/null > $TMPDIR/validate-phase-project-root.txt || pwd > $TMPDIR/validate-phase-project-root.txt
read PROJECT_ROOT < $TMPDIR/validate-phase-project-root.txt
[ -z "$PROJECT_ROOT" ] && PROJECT_ROOT="."
```

```
Task(
  prompt="Read ~/.claude/agents/gsd-nyquist-auditor.md for instructions.

<files_to_read>{PLAN, SUMMARY, impl files, VALIDATION.md}</files_to_read>

<workspace_context>
Workspace type: {WORKSPACE_TYPE}
Project root: {PROJECT_ROOT}
Submodule paths: {SUBMODULE_PATHS}

CRITICAL: Always commit to the source location. Your working directory is {PROJECT_ROOT}.
If workspace type is 'submodule', source code lives in the submodule directories listed above.
Do NOT modify deployed copies (e.g., .claude/gsd-ng/) — always edit source first.
</workspace_context>

<gaps>{gap list}</gaps>
<test_infrastructure>{framework, config, commands}</test_infrastructure>
<constraints>Never modify impl files. Max 3 debug iterations. Escalate impl bugs.</constraints>",
  subagent_type="gsd-nyquist-auditor",
  model="{AUDITOR_MODEL}",
  description="Fill validation gaps for Phase {N}"
)
```

Handle return:
- `## GAPS FILLED` → record tests + map updates, Step 6
- `## PARTIAL` → record resolved, move escalated to manual-only, Step 6
- `## ESCALATE` → move all to manual-only, Step 6

## 6. Generate/Update VALIDATION.md

**State B (create):**
1. Read template from `~/.claude/gsd-ng/templates/VALIDATION.md`
2. Fill: frontmatter, Test Infrastructure, Per-Task Map, Manual-Only, Sign-Off
3. Write to `${PHASE_DIR}/${PADDED_PHASE}-VALIDATION.md`

**State A (update):**
1. Update Per-Task Map statuses, add escalated to Manual-Only, update frontmatter
2. Append audit trail:

```markdown
## Validation Audit {date}
| Metric | Count |
|--------|-------|
| Gaps found | {N} |
| Resolved | {M} |
| Escalated | {K} |
```

## 7. Commit

```bash
git add {test_files}
git commit -m "test(phase-${PHASE}): add Nyquist validation tests"

node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" commit "docs(phase-${PHASE}): add/update validation strategy"
```

## 8. Results + Routing

**Compliant:**
```
GSD > PHASE {N} IS NYQUIST-COMPLIANT
All requirements have automated verification.
▶ Next: {{COMMAND_PREFIX}}audit-milestone
```

**Partial:**
```
GSD > PHASE {N} VALIDATED (PARTIAL)
{M} automated, {K} manual-only.
▶ Retry: {{COMMAND_PREFIX}}validate-phase {N}
```

Display `/clear` reminder.

</process>

<success_criteria>
- [ ] Nyquist config checked (exit if disabled)
- [ ] Input state detected (A/B/C)
- [ ] State C exits cleanly
- [ ] PLAN/SUMMARY files read, requirement map built
- [ ] Test infrastructure detected
- [ ] Gaps classified (COVERED/PARTIAL/MISSING)
- [ ] User gate with gap table
- [ ] Auditor spawned with complete context
- [ ] All three return formats handled
- [ ] VALIDATION.md created or updated
- [ ] Test files committed separately
- [ ] Results with routing presented
</success_criteria>
