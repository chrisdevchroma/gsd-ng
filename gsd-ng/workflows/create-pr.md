<purpose>
Create a pull request or merge request from GSD work. For phase / milestone /
quick-task entry points: creates a team-facing review branch (squashed),
pushes it, and opens a PR/MR via the appropriate platform CLI. For the
`none` branching strategy: opens PR directly from current branch.

This is the bridge between GSD's internal work and team-facing code review.
</purpose>

<required_reading>
Read STATE.md and config.json before any operation.
@~/.claude/gsd-ng/references/planning-config.md
@references/security-untrusted-content.md
</required_reading>

<process>

<step name="load_context" priority="first">
Load execution context for the phase:

```bash
# Accept phase or quick-task slug argument, or detect from current branch/state
PHASE_ARG="${ARGUMENTS%% *}"
if [ -z "$PHASE_ARG" ]; then
  # Try to detect phase from STATE.md current position
  grep -oP 'Phase:\s*\K\d+' .planning/STATE.md > $TMPDIR/create-pr-phase_arg.txt 2>/dev/null || echo "" > $TMPDIR/create-pr-phase_arg.txt
  head -1 $TMPDIR/create-pr-phase_arg.txt > $TMPDIR/create-pr-phase_arg2.txt
  read PHASE_ARG < $TMPDIR/create-pr-phase_arg2.txt
fi

# Detect quick-task slug shape: YYMMDD-XXX- (6 digits, hyphen, 3 alnum, hyphen, ...)
# Quick-task slugs match ^[0-9]{6}-[a-z0-9]{3}- ; phase numbers (e.g. 58) do not.
IS_QUICK_TASK=false
QUICK_SLUG=""
QUICK_DIR=""
QUICK_SUMMARY=""
ONE_LINER=""

if [[ "$PHASE_ARG" =~ ^[0-9]{6}-[a-z0-9]{3}- ]]; then
  IS_QUICK_TASK=true
  QUICK_SLUG="$PHASE_ARG"
  QUICK_DIR=".planning/quick/${QUICK_SLUG}"
  # Quick task SUMMARY filename convention: <slug>-SUMMARY.md inside the quick dir
  QUICK_SUMMARY="${QUICK_DIR}/${QUICK_SLUG}-SUMMARY.md"
  if [ ! -f "$QUICK_SUMMARY" ]; then
    # Fallback: some older quick tasks may use SUMMARY.md (no slug prefix)
    if [ -f "${QUICK_DIR}/SUMMARY.md" ]; then
      QUICK_SUMMARY="${QUICK_DIR}/SUMMARY.md"
    else
      echo "Error: Quick-task summary not found at ${QUICK_DIR}/${QUICK_SLUG}-SUMMARY.md or ${QUICK_DIR}/SUMMARY.md"
      exit 1
    fi
  fi
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" summary-extract "$QUICK_SUMMARY" --fields one_liner --default "" --pick one_liner > $TMPDIR/create-pr-one_liner.txt
  read ONE_LINER < $TMPDIR/create-pr-one_liner.txt
  if [ -z "$ONE_LINER" ]; then
    echo "Note: No one_liner extracted from $QUICK_SUMMARY — using slug as title."
    ONE_LINER="$QUICK_SLUG"
  fi
fi

mkdir -p $TMPDIR

if [ "$IS_QUICK_TASK" = "true" ]; then
  # Quick-task path: skip init execute-phase (it would crash on non-numeric arg).
  # Use git-context for submodule routing — it calls resolveGitContext directly.
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" git-context > $TMPDIR/create-pr-init.json 2>/dev/null || echo '{}' > $TMPDIR/create-pr-init.json
  # Remap git-context fields to the submodule_* naming that the routing block below expects.
  # git-context returns: is_submodule, git_cwd, remote, remote_url, ambiguous, target_branch, platform, cli, cli_installed, cli_install_url
  # Write a remap script and run it to avoid inline node -e with single-quoted braces
  cat > $TMPDIR/create-pr-remap.js << 'JSEOF'
try {
  const fs = require('fs');
  const c = JSON.parse(fs.readFileSync(process.argv[1], 'utf-8'));
  const out = Object.assign({}, c, {
    submodule_is_active: c.is_submodule || false,
    submodule_git_cwd: c.git_cwd || '.',
    submodule_remote: c.remote || 'origin',
    submodule_remote_url: c.remote_url || '',
    submodule_target_branch: c.target_branch || 'main',
    submodule_ambiguous: c.ambiguous || false,
    branching_strategy: 'quick',
    review_branch_template: '',
    pr_draft: c.pr_draft !== undefined ? c.pr_draft : true,
  });
  process.stdout.write(JSON.stringify(out));
} catch(e) { process.stdout.write('{}'); }
JSEOF
  node $TMPDIR/create-pr-remap.js $TMPDIR/create-pr-init.json > $TMPDIR/create-pr-init2.json
  cp $TMPDIR/create-pr-init2.json $TMPDIR/create-pr-init.json
  # Phase-specific fields are not used in the quick-task path:
  BRANCHING_STRATEGY="quick"
  BRANCH_NAME=""
  REVIEW_BRANCH_TEMPLATE=""
  PHASE_NUMBER=""
  PHASE_NAME=""
  PHASE_SLUG=""
  PHASE_DIR_NAME=""
else
  # Phase path (existing behavior).
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init execute-phase "$PHASE_ARG" > $TMPDIR/create-pr-init.json
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" guard init-valid-file $TMPDIR/create-pr-init.json 2>/dev/null || {
    node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init execute-phase "$PHASE_ARG" > $TMPDIR/create-pr-init.json
    if ! node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" guard init-valid-file $TMPDIR/create-pr-init.json; then
      echo "Error: init failed twice. Check gsd-tools installation."
      exit 1
    fi
  }
  # Extract phase fields.
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json branching_strategy > $TMPDIR/create-pr-branching_strategy.txt
  read BRANCHING_STRATEGY < $TMPDIR/create-pr-branching_strategy.txt
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json branch_name > $TMPDIR/create-pr-branch_name.txt
  read BRANCH_NAME < $TMPDIR/create-pr-branch_name.txt
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json review_branch_template > $TMPDIR/create-pr-review_branch_template.txt
  read REVIEW_BRANCH_TEMPLATE < $TMPDIR/create-pr-review_branch_template.txt
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json phase_number > $TMPDIR/create-pr-phase_number.txt
  read PHASE_NUMBER < $TMPDIR/create-pr-phase_number.txt
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json phase_name > $TMPDIR/create-pr-phase_name.txt
  read PHASE_NAME < $TMPDIR/create-pr-phase_name.txt
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json phase_slug > $TMPDIR/create-pr-phase_slug.txt
  read PHASE_SLUG < $TMPDIR/create-pr-phase_slug.txt
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json phase_dir > $TMPDIR/create-pr-phase_dir.txt
  read PHASE_DIR < $TMPDIR/create-pr-phase_dir.txt
  basename "$PHASE_DIR" > $TMPDIR/create-pr-phase_dir_name.txt
  read PHASE_DIR_NAME < $TMPDIR/create-pr-phase_dir_name.txt
fi
```

Extract from init JSON (phase path); quick-task path sets these inline above:
- `BRANCHING_STRATEGY` ← `branching_strategy`
- `BRANCH_NAME` ← `branch_name` (GSD work branch)
- `REVIEW_BRANCH_TEMPLATE` ← `review_branch_template`
- `PR_DRAFT` ← `pr_draft`
- `PHASE_NUMBER` ← `phase_number`
- `PHASE_NAME` ← `phase_name`
- `PHASE_SLUG` ← `phase_slug`
- `PHASE_DIR_NAME` ← basename of `phase_dir`

Resolve submodule-aware git routing from the init JSON:

```bash
# Read submodule fields from init JSON using a script to avoid inline node -e
cat > $TMPDIR/create-pr-extract.js << 'JSEOF'
try {
  const fs = require('fs');
  const field = process.argv[1];
  const c = JSON.parse(fs.readFileSync(process.argv[2], 'utf-8'));
  if (field === 'submodule_is_active') process.stdout.write(String(c.submodule_is_active || false));
  else if (field === 'submodule_git_cwd') process.stdout.write(c.submodule_git_cwd || '.');
  else if (field === 'submodule_ambiguous') process.stdout.write(String(c.submodule_ambiguous || false));
  else if (field === 'submodule_remote_url') process.stdout.write(c.submodule_remote_url || '');
} catch { process.stdout.write(''); }
JSEOF
node $TMPDIR/create-pr-extract.js submodule_is_active $TMPDIR/create-pr-init.json > $TMPDIR/create-pr-is_submodule.txt
read IS_SUBMODULE < $TMPDIR/create-pr-is_submodule.txt
node $TMPDIR/create-pr-extract.js submodule_git_cwd $TMPDIR/create-pr-init.json > $TMPDIR/create-pr-git_cwd.txt
read GIT_CWD < $TMPDIR/create-pr-git_cwd.txt
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json remote > $TMPDIR/create-pr-push_remote.txt
read PUSH_REMOTE < $TMPDIR/create-pr-push_remote.txt
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json target_branch > $TMPDIR/create-pr-push_target.txt
read PUSH_TARGET < $TMPDIR/create-pr-push_target.txt
if [ -z "$PUSH_TARGET" ]; then PUSH_TARGET="main"; fi
node $TMPDIR/create-pr-extract.js submodule_ambiguous $TMPDIR/create-pr-init.json > $TMPDIR/create-pr-ambiguous.txt
read AMBIGUOUS < $TMPDIR/create-pr-ambiguous.txt
node $TMPDIR/create-pr-extract.js submodule_remote_url $TMPDIR/create-pr-init.json > $TMPDIR/create-pr-submodule_remote_url.txt
read SUBMODULE_REMOTE_URL < $TMPDIR/create-pr-submodule_remote_url.txt

# Platform: read from init JSON (per-submodule override applies), fall back to detect-platform
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json platform > $TMPDIR/create-pr-platform.txt
read PLATFORM < $TMPDIR/create-pr-platform.txt
if [ -z "$PLATFORM" ]; then
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" detect-platform --field platform > $TMPDIR/create-pr-platform2.txt
  read PLATFORM < $TMPDIR/create-pr-platform2.txt
fi
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" detect-platform --field cli > $TMPDIR/create-pr-cli.txt
read CLI < $TMPDIR/create-pr-cli.txt
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" detect-platform --field cli_installed > $TMPDIR/create-pr-cli_installed.txt
read CLI_INSTALLED < $TMPDIR/create-pr-cli_installed.txt
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" detect-platform --field cli_install_url > $TMPDIR/create-pr-cli_install_url.txt
read CLI_INSTALL_URL < $TMPDIR/create-pr-cli_install_url.txt
```

Use `$PUSH_REMOTE`, `$PUSH_TARGET`, and `$GIT_CWD` for all git and platform operations below instead of `$REMOTE` and `$TARGET_BRANCH`.

**Ambiguous check:** If `$AMBIGUOUS` is `"true"`, tell the user: "Multiple submodules have changes. Cannot determine target repo for PR. Commit to only one submodule, or specify manually." Then stop — do not proceed with PR creation.

Parse flags:
- `--draft` / `--no-draft`: Override `pr_draft` config
- `--auto`: Non-interactive mode (use defaults, no prompts)
- `--type {type}`: Override branch type (feat, fix, chore, refactor)
- `--title "..."`: Override PR title

```bash
# Flag parsing
node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json pr_draft > $TMPDIR/create-pr-pr_draft.txt
read PR_DRAFT < $TMPDIR/create-pr-pr_draft.txt

if [[ "$ARGUMENTS" == *"--draft"* ]] && [[ "$ARGUMENTS" != *"--no-draft"* ]]; then
  PR_DRAFT="true"
fi
if [[ "$ARGUMENTS" == *"--no-draft"* ]]; then
  PR_DRAFT="false"
fi
AUTO_MODE=false
if [[ "$ARGUMENTS" == *"--auto"* ]]; then
  AUTO_MODE=true
fi
```
</step>

<step name="detect_platform">
Platform, CLI, and CLI availability are already extracted from the detect-platform calls above (`$PLATFORM`, `$CLI`, `$CLI_INSTALLED`, `$CLI_INSTALL_URL`). No additional call is needed.

**If `$PLATFORM` is empty:**

Warn the user: "Could not detect git hosting platform from remote URL. Set platform manually: `node gsd-tools.cjs config-set git.platform github`. Supported: github, gitlab, forgejo, gitea." Stop — return without creating PR.

**If `$CLI_INSTALLED` is `"false"`:**

Warn the user: "{CLI} CLI not found. Install from {CLI_INSTALL_URL} to enable PR creation. Do NOT use raw API calls as a workaround — install the CLI tool." Stop — return without creating PR.
</step>

<step name="validate_target_branch">
Verify the target branch exists on the remote before attempting PR creation:

```bash
if ! git -C "$GIT_CWD" ls-remote --heads "$PUSH_REMOTE" "$PUSH_TARGET" | grep -q "$PUSH_TARGET"; then
  echo "Error: Target branch '$PUSH_TARGET' not found on remote '$PUSH_REMOTE'."
  echo "Available branches:"
  git -C "$GIT_CWD" ls-remote --heads "$PUSH_REMOTE" | head -10
  if [ "$IS_SUBMODULE" = "true" ]; then
    echo "Set target branch: node gsd-tools.cjs config-set git.submodule.target_branch {branch}"
  else
    echo "Set target branch: node gsd-tools.cjs config-set git.target_branch {branch}"
  fi
  exit 1
fi
```

Fail early with clear message if target branch doesn't exist on remote.
</step>

<step name="handle_none_strategy">
**If `branching_strategy` is `"none"`:**

No review branch, no squash. Open PR directly from current branch.

```bash
if [ "$BRANCHING_STRATEGY" = "none" ]; then
  git -C "$GIT_CWD" branch --show-current > $TMPDIR/create-pr-current_branch.txt
  read CURRENT_BRANCH < $TMPDIR/create-pr-current_branch.txt
  HEAD_BRANCH="$CURRENT_BRANCH"
  # Skip to build_pr_description — no review branch needed
fi
```

For none strategy: skip `determine_type`, `create_review_branch`, and `push_review_branch` steps.
Skip to `build_pr_description` step. The PR will be opened from the current branch against `$PUSH_TARGET`.
</step>

<step name="determine_type">
Determine the branch type for the review branch naming.

```bash
if [ "$IS_QUICK_TASK" = "true" ]; then
  # Quick-task type inference: keyword match against the SUMMARY one_liner.
  # Fall back to feat when no keyword matches.
  if [[ "$ONE_LINER" =~ fix|bug|patch ]]; then
    TYPE="fix"
  elif [[ "$ONE_LINER" =~ refactor|clean|migrate ]]; then
    TYPE="refactor"
  elif [[ "$ONE_LINER" =~ chore|config|setup ]]; then
    TYPE="chore"
  else
    TYPE="feat"
  fi
  # --type flag override (shared with phase path)
  if [[ "$ARGUMENTS" =~ --type[[:space:]]+([a-z]+) ]]; then
    TYPE="${BASH_REMATCH[1]}"
  fi
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" resolve-type-alias "$TYPE" > $TMPDIR/create-pr-type_alias.txt
  read TYPE_ALIAS < $TMPDIR/create-pr-type_alias.txt
else
  # Phase path: read phase goal from ROADMAP.md and infer type.

  # In --auto mode: Default to "feature" when ambiguous.

  # In interactive mode:

  # Read phase goal from ROADMAP.md. Infer type:
  # - Goal contains "fix", "bug", "patch" -> suggest fix (branch prefix: bugfix)
  # - Goal contains "refactor", "clean", "migrate" -> suggest refactor
  # - Goal contains "chore", "config", "setup" -> suggest chore
  # - Otherwise -> suggest feat (branch prefix: feature)

  # If --type flag provided, use that directly.

  # Ask user to confirm or override (in interactive mode only):
  #   Branch type for review branch: {suggested_type} (branch prefix: {alias})
  #   Override? (enter to accept, or type: feat/fix/chore/refactor)

  # Map the short type to its branch prefix alias using resolve-type-alias
  # e.g., TYPE=feat -> TYPE_ALIAS=feature
  TYPE_INPUT="$TYPE"
  if [ -z "$TYPE_INPUT" ]; then TYPE_INPUT="feat"; fi
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" resolve-type-alias "$TYPE_INPUT" > $TMPDIR/create-pr-type_alias.txt
  read TYPE_ALIAS < $TMPDIR/create-pr-type_alias.txt
fi
```

Map the type to its alias for the branch name.
</step>

<step name="create_review_branch">
**For phase/milestone strategies only.**

Compute review branch name:
```bash
if [ "$IS_QUICK_TASK" = "true" ]; then
  # Quick-task review branch: {type_alias}/{slug}
  REVIEW_BRANCH="${TYPE_ALIAS}/${QUICK_SLUG}"
else
  # Phase path: expand template (default: "{type}/{phase}-{slug}")
  echo "$REVIEW_BRANCH_TEMPLATE" | \
    sed "s/{type}/$TYPE_ALIAS/g" | \
    sed "s/{phase}/$PHASE_NUMBER/g" | \
    sed "s/{slug}/$PHASE_SLUG/g" > $TMPDIR/create-pr-review_branch.txt
  read REVIEW_BRANCH < $TMPDIR/create-pr-review_branch.txt
fi
```

Save the current work branch for later:
```bash
git -C "$GIT_CWD" branch --show-current > $TMPDIR/create-pr-current_branch.txt
read CURRENT_BRANCH < $TMPDIR/create-pr-current_branch.txt
```

**Collision guard:** If the review branch name matches the current work branch, handle per mode to prevent data loss from `reset --hard`:
```bash
if [ "$REVIEW_BRANCH" = "$CURRENT_BRANCH" ]; then
  if [ "$AUTO_MODE" = "true" ]; then
    # Auto-suffix: append -2, -3, etc. until unique
    SUFFIX=2
    while [ "$REVIEW_BRANCH-$SUFFIX" = "$CURRENT_BRANCH" ] || git show-ref --verify --quiet "refs/heads/$REVIEW_BRANCH-$SUFFIX" 2>/dev/null; do
      (( SUFFIX++ )) || true
    done
    REVIEW_BRANCH="$REVIEW_BRANCH-$SUFFIX"
    echo "Auto-suffixed review branch to '$REVIEW_BRANCH' to avoid collision with work branch."
  else
    echo "Error: review branch '$REVIEW_BRANCH' is the same as work branch '$CURRENT_BRANCH'."
    echo "This would destroy uncommitted work via 'git reset --hard'."
    echo "Fix: set a distinct review_branch_template in config.json."
    echo "  Example: node \"\$HOME/.claude/gsd-ng/bin/gsd-tools.cjs\" config-set git.review_branch_template 'review/{phase}-{slug}'"
    exit 1
  fi
fi
```

Create or reset review branch from target_branch:
```bash
if git -C "$GIT_CWD" show-ref --verify --quiet "refs/heads/$REVIEW_BRANCH" 2>/dev/null; then
  # Review branch exists — this is an update (re-squash)
  git -C "$GIT_CWD" checkout "$REVIEW_BRANCH"
  git -C "$GIT_CWD" reset --hard "$PUSH_TARGET"
else
  git -C "$GIT_CWD" checkout -b "$REVIEW_BRANCH" "$PUSH_TARGET"
fi
```

Squash work branch onto review branch:
```bash
# Single squash of all work from the GSD work branch
git -C "$GIT_CWD" merge --squash "$CURRENT_BRANCH" 2>&1

if [ "$IS_QUICK_TASK" = "true" ]; then
  # Quick-task squash message: subject = "<type>: <one_liner>", body = SUMMARY.md content
  cat "$QUICK_SUMMARY" > $TMPDIR/create-pr-squash_body.txt
  read SQUASH_BODY < $TMPDIR/create-pr-squash_body.txt
  printf "%s: %s\n\n%s" "$TYPE" "$ONE_LINER" "$SQUASH_BODY" > $TMPDIR/create-pr-squash_msg.txt
  git -C "$GIT_CWD" commit -F $TMPDIR/create-pr-squash_msg.txt
else
  # Phase path: build squash message from plan SUMMARYs glob
  SQUASH_MSG=""
  for summary in .planning/phases/${PHASE_DIR_NAME}/*-SUMMARY.md; do
    [ -f "$summary" ] || continue
    node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" summary-extract "$summary" --fields one_liner --default "" --pick one_liner > $TMPDIR/create-pr-one_liner_plan.txt
    read ONE_LINER_PLAN < $TMPDIR/create-pr-one_liner_plan.txt
    if [ -n "$ONE_LINER_PLAN" ]; then
      basename "$summary" > $TMPDIR/create-pr-summary_basename.txt
      read SUMMARY_BASENAME < $TMPDIR/create-pr-summary_basename.txt
      PLAN_ID="${SUMMARY_BASENAME%-SUMMARY.md}"
      SQUASH_MSG="${SQUASH_MSG}- ${PLAN_ID}: ${ONE_LINER_PLAN}\n"
    fi
  done

  if [ -z "$SQUASH_MSG" ]; then
    SQUASH_MSG="Phase ${PHASE_NUMBER}: ${PHASE_NAME}"
  fi

  printf "feat: Phase ${PHASE_NUMBER} - ${PHASE_NAME}\n\n${SQUASH_MSG}" > $TMPDIR/create-pr-phase_squash_msg.txt
  git -C "$GIT_CWD" commit -F $TMPDIR/create-pr-phase_squash_msg.txt
fi
```

Set HEAD_BRANCH for PR creation:
```bash
HEAD_BRANCH="$REVIEW_BRANCH"
```
</step>

<step name="push_review_branch">
Push the review branch (or current branch for none strategy) to remote:

```bash
# For review branches, use --force-with-lease (squash rewrites history)
if [ "$BRANCHING_STRATEGY" != "none" ]; then
  git -C "$GIT_CWD" push --force-with-lease -u "$PUSH_REMOTE" "$HEAD_BRANCH" > $TMPDIR/create-pr-push_out.txt 2>&1
else
  # For none strategy, regular push with upstream tracking (safe to use -u unconditionally)
  git -C "$GIT_CWD" rev-parse --abbrev-ref --symbolic-full-name "@{u}" > $TMPDIR/create-pr-upstream.txt 2>/dev/null || echo "" > $TMPDIR/create-pr-upstream.txt
  read UPSTREAM < $TMPDIR/create-pr-upstream.txt
  if [ -n "$UPSTREAM" ]; then
    git -C "$GIT_CWD" push "$PUSH_REMOTE" "$HEAD_BRANCH" > $TMPDIR/create-pr-push_out.txt 2>&1
  else
    git -C "$GIT_CWD" push -u "$PUSH_REMOTE" "$HEAD_BRANCH" > $TMPDIR/create-pr-push_out.txt 2>&1
  fi
fi
PUSH_EXIT=$?

if [ $PUSH_EXIT -ne 0 ]; then
  read PUSH_OUT < $TMPDIR/create-pr-push_out.txt
  echo "Error: Push failed — $PUSH_OUT"
  echo "Fix the issue and retry: {{COMMAND_PREFIX}}create-pr ${PHASE_ARG}"
  # Return to work branch before exiting
  git -C "$GIT_CWD" checkout "$CURRENT_BRANCH" 2>/dev/null || true
  exit 1
fi

if grep -q 'Bypassed rule violations' $TMPDIR/create-pr-push_out.txt; then
  echo "Error: push bypassed required branch protection rules:"
  grep -E '(Bypassed rule violations|^remote: -)' $TMPDIR/create-pr-push_out.txt | sed 's/^/  /'
  exit 1
fi
```

STOP on push failure — cannot create PR without pushed branch.

Return to work branch after push (for phase/milestone strategies):
```bash
if [ "$BRANCHING_STRATEGY" != "none" ]; then
  git -C "$GIT_CWD" checkout "$CURRENT_BRANCH" 2>/dev/null || true
fi
```
</step>

<step name="build_pr_description">
Build PR description.

```bash
PR_BODY_FILE="$TMPDIR/create-pr-pr_body.txt"
touch "$PR_BODY_FILE"

if [ "$IS_QUICK_TASK" = "true" ]; then
  # Quick-task description: SUMMARY-derived. No template precedence chain
  # (a dedicated quick_pr_template config knob is deferred to a future phase).
  # Build PR body by concatenating sections to avoid command substitution inside heredoc
  printf "## Summary\n\n%s\n\n" "$ONE_LINER" > "$PR_BODY_FILE"
  cat "${QUICK_SUMMARY}" >> "$PR_BODY_FILE"
  printf "\n\n## Test Plan\n\n- [ ] Automated tests pass\n- [ ] Manual verification complete\n\n---\n*Generated by GSD-NG from quick task %s*\n" "$QUICK_SLUG" >> "$PR_BODY_FILE"

else
  # Phase path: template precedence chain — user config > repo template > GSD default.

  # 1. Check user config template
  node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/create-pr-init.json pr_template > $TMPDIR/create-pr-pr_template_path.txt
  read PR_TEMPLATE_PATH < $TMPDIR/create-pr-pr_template_path.txt

  if [ -n "$PR_TEMPLATE_PATH" ] && [ -f "$PR_TEMPLATE_PATH" ]; then
    # User config template — copy and apply variable substitution below
    cp "$PR_TEMPLATE_PATH" "$PR_BODY_FILE"

  elif [ -f ".github/PULL_REQUEST_TEMPLATE.md" ]; then
    # GitHub repo template
    echo "(Using repo PR template from .github/PULL_REQUEST_TEMPLATE.md)"
    cp ".github/PULL_REQUEST_TEMPLATE.md" "$PR_BODY_FILE"

  elif [ -d ".gitlab/merge_request_templates" ]; then
    # GitLab repo template — use Default.md if it exists
    GITLAB_TEMPLATE=".gitlab/merge_request_templates/Default.md"
    if [ -f "$GITLAB_TEMPLATE" ]; then
      echo "(Using repo MR template from $GITLAB_TEMPLATE)"
      cp "$GITLAB_TEMPLATE" "$PR_BODY_FILE"
    fi

  else
    # GSD default professional template
    # Extract phase goal using --pick
    node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" roadmap get-phase "$PHASE_NUMBER" --pick goal --default "" > $TMPDIR/create-pr-phase_objective.txt
    read PHASE_OBJECTIVE < $TMPDIR/create-pr-phase_objective.txt

    # Extract plan summaries
    PLAN_SUMMARIES=""
    for summary in .planning/phases/${PHASE_DIR_NAME}/*-SUMMARY.md; do
      [ -f "$summary" ] || continue
      node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" summary-extract "$summary" --fields one_liner --default "" --pick one_liner > $TMPDIR/create-pr-one_liner_plan.txt
      read ONE_LINER_PLAN < $TMPDIR/create-pr-one_liner_plan.txt
      if [ -n "$ONE_LINER_PLAN" ]; then
        basename "$summary" > $TMPDIR/create-pr-summary_basename2.txt
        read SUMMARY_BASENAME < $TMPDIR/create-pr-summary_basename2.txt
        PLAN_ID="${SUMMARY_BASENAME%-SUMMARY.md}"
        PLAN_SUMMARIES="${PLAN_SUMMARIES}\n- **${PLAN_ID}**: ${ONE_LINER_PLAN}"
      fi
    done

    # Use plain vars with explicit fallbacks to avoid parameter expansion in heredoc
    PHASE_OBJECTIVE_DISPLAY="$PHASE_OBJECTIVE"
    if [ -z "$PHASE_OBJECTIVE_DISPLAY" ]; then PHASE_OBJECTIVE_DISPLAY="Phase ${PHASE_NUMBER}: ${PHASE_NAME}"; fi
    PLAN_SUMMARIES_DISPLAY="$PLAN_SUMMARIES"
    if [ -z "$PLAN_SUMMARIES_DISPLAY" ]; then PLAN_SUMMARIES_DISPLAY="No plan summaries available."; fi
    cat > "$PR_BODY_FILE" << PRTEMPLATE
## Summary

${PHASE_OBJECTIVE_DISPLAY}

## Changes
${PLAN_SUMMARIES_DISPLAY}

## Test Plan

- [ ] Automated tests pass
- [ ] Manual verification complete

---
*Generated by [GSD-NG](https://github.com/chrisdevchroma/gsd-ng) from phase ${PHASE_NUMBER} execution*
PRTEMPLATE
  fi

  # Apply GSD variable substitution to whichever template was selected
  PHASE_OBJ_SED="$PHASE_OBJECTIVE"
  sed -i \
    -e "s/{phase_name}/${PHASE_NAME}/g" \
    -e "s/{phase_number}/${PHASE_NUMBER}/g" \
    -e "s/{phase_objective}/${PHASE_OBJ_SED}/g" \
    "$PR_BODY_FILE"
fi
```
</step>

<step name="sanitize_outbound">
Before building the PR title or creating the PR, sanitize the description body:

If the PR body contains `<untrusted-content` tags (from imported issue content in phase context), these must be stripped before submission. These tags are for internal GSD agent use and should not appear in GitHub/GitLab PR descriptions.

```bash
# The agent should process the PR body text to remove wrapper tags
# Replace: <untrusted-content source="...">content</untrusted-content>
# With: content (inner text preserved, tags removed)
if grep -q '<untrusted-content' "$PR_BODY_FILE" 2>/dev/null; then
  # Strip opening tags: <untrusted-content source="...">
  # Strip closing tags: </untrusted-content>
  # Preserve everything between the tags (inner content intact)
  sed -i 's|<untrusted-content[^>]*>||g; s|</untrusted-content>||g' "$PR_BODY_FILE"
fi
```

This is a text transformation the agent performs on the PR body string before passing it to `gh pr create`. The pattern to remove is:
- Opening tag: `<untrusted-content source="...">` (any source value)
- Closing tag: `</untrusted-content>`
- Preserve everything between the tags

If no `<untrusted-content` tags are present, no action needed.

Note: `stripUntrustedWrappers()` in `bin/lib/security.cjs` implements the same logic programmatically for non-workflow code paths. This step is the agent-facing equivalent.
</step>

<step name="build_pr_title">
Determine PR title:

```bash
if [ -n "$TITLE_FLAG" ]; then
  PR_TITLE="$TITLE_FLAG"  # --title flag wins (existing behavior)
elif [ "$IS_QUICK_TASK" = "true" ]; then
  PR_TITLE="${TYPE}: ${ONE_LINER}"
else
  PR_TITLE="Phase ${PHASE_NUMBER}: ${PHASE_NAME}"
fi
```

In interactive mode (no `--auto`), ask user to confirm or edit:
```
PR title: {PR_TITLE}
Edit? (enter to accept, or type new title)
```
</step>

<step name="create_pr">
Create the PR/MR using the platform-specific CLI. The body file (`$PR_BODY_FILE`) has been sanitized of `<untrusted-content>` wrapper tags by the `sanitize_outbound` step — external systems should never receive these internal GSD tags.

```bash
# Determine draft flag
DRAFT_FLAG=""
if [ "$PR_DRAFT" = "true" ]; then
  DRAFT_FLAG="--draft"
fi

case "$PLATFORM" in
  github)
    gh pr create \
      --base "$PUSH_TARGET" \
      --head "$HEAD_BRANCH" \
      --title "$PR_TITLE" \
      --body-file "$PR_BODY_FILE" \
      $DRAFT_FLAG > $TMPDIR/create-pr-pr_url.txt 2>&1
    PR_EXIT=$?
    read PR_URL < $TMPDIR/create-pr-pr_url.txt
    ;;

  gitlab)
    glab mr create \
      --target-branch "$PUSH_TARGET" \
      --source-branch "$HEAD_BRANCH" \
      --title "$PR_TITLE" \
      --description-file "$PR_BODY_FILE" \
      $DRAFT_FLAG > $TMPDIR/create-pr-pr_url.txt 2>&1
    PR_EXIT=$?
    read PR_URL < $TMPDIR/create-pr-pr_url.txt
    ;;

  forgejo)
    PR_BODY_TEXT=""
    if [ -f "$PR_BODY_FILE" ]; then
      read -d '' PR_BODY_TEXT < "$PR_BODY_FILE" || true
    fi
    fj pr create \
      --base "$PUSH_TARGET" \
      --head "$HEAD_BRANCH" \
      --title "$PR_TITLE" \
      --body "$PR_BODY_TEXT" > $TMPDIR/create-pr-pr_url.txt 2>&1
    PR_EXIT=$?
    read PR_URL < $TMPDIR/create-pr-pr_url.txt
    ;;

  gitea)
    PR_BODY_TEXT=""
    if [ -f "$PR_BODY_FILE" ]; then
      read -d '' PR_BODY_TEXT < "$PR_BODY_FILE" || true
    fi
    tea pr create \
      --base "$PUSH_TARGET" \
      --head "$HEAD_BRANCH" \
      --title "$PR_TITLE" \
      --description "$PR_BODY_TEXT" > $TMPDIR/create-pr-pr_url.txt 2>&1
    PR_EXIT=$?
    read PR_URL < $TMPDIR/create-pr-pr_url.txt
    ;;

  *)
    echo "Error: Unknown platform '$PLATFORM'"
    PR_EXIT=1
    ;;
esac

# Cleanup temp file
rm -f "$PR_BODY_FILE"
```

Handle result:
```bash
if [ $PR_EXIT -ne 0 ]; then
  echo "Error: PR creation failed: $PR_URL"
  echo "Branch '$HEAD_BRANCH' is pushed — create PR manually at your hosting platform."
else
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo " GSD > PR CREATED"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo ""
  if [ "$IS_QUICK_TASK" = "true" ]; then
    echo "  Quick:  ${QUICK_SLUG}"
  else
    echo "  Phase:  ${PHASE_NUMBER} - ${PHASE_NAME}"
  fi
  echo "  Branch: ${HEAD_BRANCH} -> ${PUSH_TARGET}"
  echo "  Draft:  ${PR_DRAFT}"
  echo "  URL:    ${PR_URL}"
  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
fi
```
</step>

<step name="detect_repo_template_notice">
If a repo template exists but was NOT used (because user config took precedence), surface a notice:

```bash
if [ -n "$PR_TEMPLATE_PATH" ]; then
  if [ -f ".github/PULL_REQUEST_TEMPLATE.md" ]; then
    echo "Note: Repo PR template exists at .github/PULL_REQUEST_TEMPLATE.md but was overridden by git.pr_template config."
  fi
  if [ -d ".gitlab/merge_request_templates" ]; then
    echo "Note: Repo MR templates exist at .gitlab/merge_request_templates/ but were overridden by git.pr_template config."
  fi
fi
```
</step>

</process>

<success_criteria>
- [ ] Platform detected from remote URL or config
- [ ] CLI availability verified (missing CLI produces clear warning, Do NOT use raw API calls as a workaround — install the CLI tool)
- [ ] Target branch validated on remote
- [ ] Review branch created and squashed from work branch (for phase/milestone strategies)
- [ ] PR description built from template precedence chain (user config > repo template > GSD default)
- [ ] PR created via platform CLI (gh pr create / glab mr create / fj pr create / tea pr create)
- [ ] PR URL displayed to user
- [ ] Work branch restored as current branch after PR creation
- [ ] force-with-lease used for review branch re-push (squash rewrites history)
- [ ] Repo template detection with notice when overridden by user config
- [ ] Quick-task slug detected from $PHASE_ARG when matching ^[0-9]{6}-[a-z0-9]{3}- ; SUMMARY-derived squash + PR
</success_criteria>
