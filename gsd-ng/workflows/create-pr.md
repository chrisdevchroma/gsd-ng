<purpose>
Create a pull request or merge request from GSD work. For phase/milestone strategies:
creates a team-facing review branch (squashed), pushes it, and opens a PR/MR via
the appropriate platform CLI. For none strategy: opens PR directly from current branch.

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
# Accept phase argument, or detect from current branch/state
PHASE_ARG="${ARGUMENTS%% *}"
if [ -z "$PHASE_ARG" ]; then
  # Try to detect phase from STATE.md current position
  PHASE_ARG=$(grep -oP 'Phase:\s*\K\d+' .planning/STATE.md 2>/dev/null | head -1)
fi

INIT=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" init execute-phase "${PHASE_ARG}")
if [[ "$INIT" == @file:* ]]; then INIT=$(cat "${INIT#@file:}"); fi
```

Extract from init JSON:
- `BRANCHING_STRATEGY` ← `branching_strategy`
- `BRANCH_NAME` ← `branch_name` (GSD work branch)
- `REVIEW_BRANCH_TEMPLATE` ← `review_branch_template`
- `PR_DRAFT` ← `pr_draft`
- `PHASE_NUMBER` ← `phase_number`
- `PHASE_NAME` ← `phase_name`
- `PHASE_SLUG` ← `phase_slug`
- `PHASE_DIR_NAME` ← basename of `phase_dir`

Resolve submodule-aware git routing via git-context:

```bash
GIT_CTX=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" git-context)
if [[ "$GIT_CTX" == @file:* ]]; then GIT_CTX=$(cat "${GIT_CTX#@file:}"); fi
GIT_CWD=$(node -e "try{const c=JSON.parse(process.argv[1]);process.stdout.write(c.git_cwd||'.')}catch{process.stdout.write('.')}" "$GIT_CTX")
PUSH_REMOTE=$(node -e "try{const c=JSON.parse(process.argv[1]);process.stdout.write(c.remote||'origin')}catch{process.stdout.write('origin')}" "$GIT_CTX")
PUSH_TARGET=$(node -e "try{const c=JSON.parse(process.argv[1]);process.stdout.write(c.target_branch||'main')}catch{process.stdout.write('main')}" "$GIT_CTX")
AMBIGUOUS=$(node -e "try{const c=JSON.parse(process.argv[1]);process.stdout.write(String(c.ambiguous||false))}catch{process.stdout.write('false')}" "$GIT_CTX")
SSH_URL=$(node -e "try{const c=JSON.parse(process.argv[1]);process.stdout.write(String(c.ssh_url||false))}catch{process.stdout.write('false')}" "$GIT_CTX")
PLATFORM=$(node -e "try{const c=JSON.parse(process.argv[1]);process.stdout.write(c.platform||'')}catch{process.stdout.write('')}" "$GIT_CTX")
CLI=$(node -e "try{const c=JSON.parse(process.argv[1]);process.stdout.write(c.cli||'')}catch{process.stdout.write('')}" "$GIT_CTX")
CLI_INSTALLED=$(node -e "try{const c=JSON.parse(process.argv[1]);process.stdout.write(String(c.cli_installed||false))}catch{process.stdout.write('false')}" "$GIT_CTX")
CLI_INSTALL_URL=$(node -e "try{const c=JSON.parse(process.argv[1]);process.stdout.write(c.cli_install_url||'')}catch{process.stdout.write('')}" "$GIT_CTX")
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
PR_DRAFT=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" config-get git.pr_draft --raw 2>/dev/null || echo "true")

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
Platform, CLI, and CLI availability are already extracted from git-context output above (`$PLATFORM`, `$CLI`, `$CLI_INSTALLED`, `$CLI_INSTALL_URL`). No separate detect-platform call is needed.

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
  echo "Set target branch: node gsd-tools.cjs config-set git.submodule.target_branch {branch}"
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
  CURRENT_BRANCH=$(git -C "$GIT_CWD" branch --show-current)
  HEAD_BRANCH="$CURRENT_BRANCH"
  # Skip to build_pr_description — no review branch needed
fi
```

For none strategy: skip `determine_type`, `create_review_branch`, and `push_review_branch` steps.
Skip to `build_pr_description` step. The PR will be opened from the current branch against `$PUSH_TARGET`.
</step>

<step name="determine_type">
For phase/milestone strategies, determine the branch type for review branch naming.

**In `--auto` mode:** Default to `feature` when ambiguous.

**In interactive mode:**

Read phase goal from ROADMAP.md. Infer type:
- Goal contains "fix", "bug", "patch" -> suggest `fix` (branch prefix: `bugfix`)
- Goal contains "refactor", "clean", "migrate" -> suggest `refactor`
- Goal contains "chore", "config", "setup" -> suggest `chore`
- Otherwise -> suggest `feat` (branch prefix: `feature`)

If `--type` flag provided, use that directly.

Ask user to confirm or override (in interactive mode only):
```
Branch type for review branch: {suggested_type} (branch prefix: {alias})
Override? (enter to accept, or type: feat/fix/chore/refactor)
```

Load type aliases from config:
```bash
# Map the short type to its branch prefix alias using resolve-type-alias
# e.g., TYPE=feat -> TYPE_ALIAS=feature
TYPE_ALIAS=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" resolve-type-alias "${TYPE:-feat}" --raw 2>/dev/null || echo "${TYPE:-feature}")
```

Map the type to its alias for the branch name.
</step>

<step name="create_review_branch">
**For phase/milestone strategies only.**

Compute review branch name from template:
```bash
# review_branch_template default: "{type}/{phase}-{slug}"
REVIEW_BRANCH=$(echo "$REVIEW_BRANCH_TEMPLATE" | \
  sed "s/{type}/$TYPE_ALIAS/g" | \
  sed "s/{phase}/$PHASE_NUMBER/g" | \
  sed "s/{slug}/$PHASE_SLUG/g")
```

Save the current work branch for later:
```bash
CURRENT_BRANCH=$(git -C "$GIT_CWD" branch --show-current)
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

# Build squash commit message from plan summaries
SQUASH_MSG=""
for summary in $(ls .planning/phases/${PHASE_DIR_NAME}/*-SUMMARY.md 2>/dev/null | sort); do
  ONE_LINER=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" summary-extract "$summary" --fields one_liner --raw 2>/dev/null || echo "")
  if [ -n "$ONE_LINER" ]; then
    PLAN_ID=$(basename "$summary" | sed 's/-SUMMARY.md//')
    SQUASH_MSG="${SQUASH_MSG}- ${PLAN_ID}: ${ONE_LINER}\n"
  fi
done

if [ -z "$SQUASH_MSG" ]; then
  SQUASH_MSG="Phase ${PHASE_NUMBER}: ${PHASE_NAME}"
fi

git -C "$GIT_CWD" commit -m "$(printf "feat: Phase ${PHASE_NUMBER} - ${PHASE_NAME}\n\n${SQUASH_MSG}")"
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
  PUSH_OUT=$(git -C "$GIT_CWD" push --force-with-lease -u "$PUSH_REMOTE" "$HEAD_BRANCH" 2>&1)
else
  # For none strategy, regular push with upstream tracking (safe to use -u unconditionally)
  UPSTREAM=$(git -C "$GIT_CWD" rev-parse --abbrev-ref --symbolic-full-name "@{u}" 2>/dev/null || echo "")
  if [ -n "$UPSTREAM" ]; then
    PUSH_OUT=$(git -C "$GIT_CWD" push "$PUSH_REMOTE" "$HEAD_BRANCH" 2>&1)
  else
    PUSH_OUT=$(git -C "$GIT_CWD" push -u "$PUSH_REMOTE" "$HEAD_BRANCH" 2>&1)
  fi
fi
PUSH_EXIT=$?

if [ $PUSH_EXIT -ne 0 ]; then
  echo "Error: Push failed — $PUSH_OUT"
  echo "Fix the issue and retry: /gsd:create-pr ${PHASE_ARG}"
  # Return to work branch before exiting
  git -C "$GIT_CWD" checkout "$CURRENT_BRANCH" 2>/dev/null || true
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
Build PR description following template precedence: user config > repo template > GSD default.

```bash
PR_BODY_FILE=$(mktemp)

# 1. Check user config template
PR_TEMPLATE_PATH=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" config-get git.pr_template --raw 2>/dev/null || echo "")

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
  # Extract phase goal from ROADMAP
  PHASE_OBJECTIVE=$(grep -A 5 "Phase ${PHASE_NUMBER}:" .planning/ROADMAP.md 2>/dev/null | grep "Goal" | sed 's/.*Goal.*:\*\* *//' | head -1)

  # Extract plan summaries
  PLAN_SUMMARIES=""
  for summary in $(ls .planning/phases/${PHASE_DIR_NAME}/*-SUMMARY.md 2>/dev/null | sort); do
    ONE_LINER=$(node "$HOME/.claude/gsd-ng/bin/gsd-tools.cjs" summary-extract "$summary" --fields one_liner --raw 2>/dev/null || echo "")
    if [ -n "$ONE_LINER" ]; then
      PLAN_ID=$(basename "$summary" | sed 's/-SUMMARY.md//')
      PLAN_SUMMARIES="${PLAN_SUMMARIES}\n- **${PLAN_ID}**: ${ONE_LINER}"
    fi
  done

  cat > "$PR_BODY_FILE" << PRTEMPLATE
## Summary

${PHASE_OBJECTIVE:-Phase ${PHASE_NUMBER}: ${PHASE_NAME}}

## Changes
${PLAN_SUMMARIES:-No plan summaries available.}

## Test Plan

- [ ] Automated tests pass
- [ ] Manual verification complete

---
*Generated by [GSD-NG](https://github.com/chrisdevchroma/gsd-ng) from phase ${PHASE_NUMBER} execution*
PRTEMPLATE
fi
```

Apply GSD variable substitution to whichever template was selected:
```bash
sed -i \
  -e "s/{phase_name}/${PHASE_NAME}/g" \
  -e "s/{phase_number}/${PHASE_NUMBER}/g" \
  -e "s/{phase_objective}/${PHASE_OBJECTIVE:-}/g" \
  "$PR_BODY_FILE"
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

If `--title` flag provided, use it directly.

Otherwise, build from phase context:
```bash
PR_TITLE="Phase ${PHASE_NUMBER}: ${PHASE_NAME}"
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
    PR_URL=$(gh pr create \
      --base "$PUSH_TARGET" \
      --head "$HEAD_BRANCH" \
      --title "$PR_TITLE" \
      --body-file "$PR_BODY_FILE" \
      $DRAFT_FLAG 2>&1)
    PR_EXIT=$?
    ;;

  gitlab)
    PR_URL=$(glab mr create \
      --target-branch "$PUSH_TARGET" \
      --source-branch "$HEAD_BRANCH" \
      --title "$PR_TITLE" \
      --description "$(cat "$PR_BODY_FILE")" \
      $DRAFT_FLAG 2>&1)
    PR_EXIT=$?
    ;;

  forgejo)
    PR_URL=$(fj pr create \
      --base "$PUSH_TARGET" \
      --head "$HEAD_BRANCH" \
      --title "$PR_TITLE" \
      --body "$(cat "$PR_BODY_FILE")" 2>&1)
    PR_EXIT=$?
    ;;

  gitea)
    PR_URL=$(tea pr create \
      --base "$PUSH_TARGET" \
      --head "$HEAD_BRANCH" \
      --title "$PR_TITLE" \
      --description "$(cat "$PR_BODY_FILE")" 2>&1)
    PR_EXIT=$?
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
  echo "  Phase:  ${PHASE_NUMBER} - ${PHASE_NAME}"
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
</success_criteria>
