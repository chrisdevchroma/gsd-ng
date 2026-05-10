# bash-safety-hook — architecture and design decisions

> Port of [liberzon/claude-hooks](https://github.com/liberzon/claude-hooks)
> to CommonJS Node, with additions specific to gsd-ng (STRUCTURAL_KEYWORDS,
> per-platform CLI patterns, settings layering). File:
> `hooks/bash-safety-hook.cjs`.

---

## Why this hook exists

Claude Code's built-in `permissions.allow` rules match commands as a whole
string. For compound commands like `git status && curl http://evil.com`,
a prefix match on `git status` auto-approves the whole line — including
the second command. The hook closes that gap by decomposing compound
commands and checking each sub-command against allow/deny patterns
independently.

Secondarily, returning `{"permissionDecision":"allow"}` from the hook
suppresses the tree-sitter-walker prompt described in
[`claude-stability/docs/research/claude-code-internals/tree-sitter-walker-regression.md`](https://github.com/chrisdevchroma/claude-stability/blob/main/docs/research/claude-code-internals/tree-sitter-walker-regression.md)
for any command the hook can fully approve.

## Pipeline inside the hook

```
stdin (Claude Code tool_use JSON)
    │
    ▼
loadMergedSettings()    ─ reads 4 layers: global/global-local/project/project-local
    │
    ▼
decomposeCommand(cmd)   ─ returns a list of normalized sub-commands
    │                     by splitting on &&, ||, ;, |, newlines, $(),
    │                     backticks; stripping heredoc bodies, redirections,
    │                     env-var prefixes; filtering STRUCTURAL_KEYWORDS
    │                     and standalone assignments.
    ▼
decide(subs, settings)  ─ deny-first, then allow-all; passthrough if any
    │                     sub is unmatched.
    ▼
stdout: one of
    {"permissionDecision":"allow",  "permissionDecisionReason":"..."}
    {"permissionDecision":"deny",   "permissionDecisionReason":"..."}
    (silent exit → passthrough to Claude Code's default handling)
```

Design rule: **never block tool execution on hook errors.** JSON parse
failures, stdin timeouts, filesystem errors all exit 0 silently and let
Claude Code fall through to its normal prompting. A broken hook must be
a soft inconvenience, not a hard blocker.

## The four design decisions you most need to know

### 1. STRUCTURAL_KEYWORDS vs allowlist entries

Shell constructs appearing as decomposed sub-commands fall into two groups:

| Group                                                                                                                       | Handling                                                                                           | Example                                                                                                         |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **Nullary and syntax markers** — `done`, `fi`, `then`, `else`, `elif`, `do`, `break`, `continue`, `{`, `}`, `true`, `false` | In `STRUCTURAL_KEYWORDS` → filtered out entirely before allowlist check                            | `cmd \|\| true` → `true` sub-command skipped; decision depends only on `cmd`                                    |
| **Builtins that may wrap a subshell** — `exit`, `return`, `local`, `export`                                                 | In the allowlist as `Bash(<builtin> *)` → decomposer still runs `extractSubshells()` on their args | `local x=$(curl evil.com)` → outer `local` matches `Bash(local *)`, inner `curl` ALSO checked against allowlist |

**Why the split matters.** If `local` were in `STRUCTURAL_KEYWORDS`, the
decomposer's per-part loop would `continue` on the structural match before
reaching the subshell extraction code. The inner `curl evil.com` would
bypass all allowlist checks. Keeping `local`/`export`/`exit`/`return` in
the allowlist lane preserves subshell validation while still auto-approving
the common idioms `cmd || exit 1`, `local x=$(...)`, etc.

**`eval` is deliberately in neither group.** It executes arbitrary strings
at runtime, which no static analysis can verify. `eval` always falls
through to a user prompt.

### 2. Per-platform CLI granularity

`bin/lib/allowlist.cjs` exports `getPlatformCliPatterns(cli)` which
generates granular per-subcommand entries for GitHub (`gh`), GitLab
(`glab`), Forgejo (`fj`), and Gitea (`tea`) CLIs. Example for `gh`:

```
Bash(gh pr *), Bash(gh pr), Bash(gh issue *), Bash(gh issue),
Bash(gh release *), Bash(gh release), Bash(gh workflow *), Bash(gh workflow),
Bash(gh auth *),   Bash(gh auth),   Bash(gh repo *),   Bash(gh repo),
Bash(gh search *), Bash(gh search)
```

Rather than blanket `Bash(gh *)`. This intentionally excludes:

- `gh api` / `glab api` — arbitrary REST calls; users sometimes want
  prompt-per-call for these
- `gh extension` — installs arbitrary code from third-party repos

The installer (`bin/install.js`) detects which CLIs are locally available
and injects patterns for only those CLIs into the seeded `.claude/settings.json`.

### 3. Settings layering

`loadMergedSettings()` merges permissions.allow/deny arrays across up to
four layers:

1. `$CLAUDE_SETTINGS_PATH` or `~/.claude/settings.json` (global)
2. `~/.claude/settings.local.json` (global, gitignored)
3. `$CLAUDE_PROJECT_DIR/.claude/settings.json` (project, committed)
4. `$CLAUDE_PROJECT_DIR/.claude/settings.local.json` (project, gitignored)

Entries are deduplicated and order-preserving. This matches Claude Code's
own layering so users can allowlist tools at whatever scope makes sense
(a team-wide `Bash(foo *)` in project settings; personal additions in
project-local settings).

### 4. Deny-first, allow-all

```
for each sub_command:
    if matches any deny pattern → return deny
for each sub_command:
    if does NOT match any allow pattern → return passthrough
return allow
```

**Passthrough** (silent exit) is different from deny — it lets Claude Code
run its own permission logic, which may still allow the command based on
looser top-level matching, or may prompt the user. The hook never forces
a prompt; it only actively approves or actively denies.

## Template location

One canonical template ships in the source tree:

- `gsd-ng/templates/settings-sandbox.json` — consumed by `bin/install.js`
  for both Claude Code and Copilot runtimes.

## How additions land in an installed workspace

1. Edit the source in `gsd-ng/templates/settings-sandbox.json`.
2. Commit in the submodule boundary.
3. Run `node bin/install.js --local --runtime claude` (or copilot) from
   the consuming workspace.
4. `install.js` computes `template.allow ∪ getPlatformCliPatterns(cli) for
detected clis` and writes the union to `.claude/settings.json`,
   preserving any user-specific additions that aren't template-managed.

Verify the result with the allowlist-parity diagnostic script:

```sh
node claude-stability/docs/research/claude-code-internals/scripts/verify-allowlist-parity.cjs \
  --local=.claude/settings.json \
  --template=gsd-ng/templates/settings-sandbox.json \
  --allowlist-mod=gsd-ng/bin/lib/allowlist.cjs
```

## Relationship to Claude Code's upstream regression

The tree-sitter walker issue documented in
`claude-stability/docs/research/claude-code-internals/tree-sitter-walker-regression.md`
sometimes fires despite this hook emitting `allow`. When that happens, the
workaround is at the source level — rewrite the triggering syntax in
workflow templates. See the research doc for trigger patterns and
rewrite strategies.

For most cases (`${VAR:-$(...)}`, `$()` command substitution, heredocs,
compound statements) the hook's `allow` suppresses the walker prompt and
no workaround is needed. Validation data at
`claude-stability/.../tree-sitter-walker-regression.md#validation-data`.

## Pattern catalog for hook-safe workflow authoring

This catalog documents the canonical substitutions for patterns the hook
denies. Each entry shows OLD (denied) bash + NEW (allowed) bash + a
one-line rationale pointing at the relevant hook check. Use these patterns
when writing or modifying GSD workflows, agents, commands, or references.
New contributors: see [CONTRIBUTING.md](../CONTRIBUTING.md) for
workflow-authoring guidance.

### Pattern A — capture init JSON to file

**Replaces:** `INIT=$(node ... gsd-tools.cjs init <op> ...)` — denied
because `$(...)` is hook-flagged.

**OLD (denied):**

```bash
INIT=$(node "$CLAUDE_PROJECT_DIR/.claude/gsd-ng/bin/gsd-tools.cjs" init execute-phase "$PHASE_ARG")
```

**NEW (allowed):**

```bash
mkdir -p $TMPDIR
node "$CLAUDE_PROJECT_DIR/.claude/gsd-ng/bin/gsd-tools.cjs" init execute-phase "$PHASE_ARG" > $TMPDIR/execute-phase-init.json
```

**Rationale:** Redirect (`>`) is not a command substitution; the
bash-safety hook only flags `$(...)` and backticks for command capture.
Use a workflow-specific tmp filename prefix (`execute-phase-init.json`) to
avoid parallel-run collisions.

### Pattern B — extract field via init-get-from-file

**Replaces:** `FOO=$(node ... init-get "$INIT" foo)` — denied because
`$(...)` is hook-flagged.

**OLD (denied):**

```bash
BRANCHING_STRATEGY=$(node "$CLAUDE_PROJECT_DIR/.claude/gsd-ng/bin/gsd-tools.cjs" init-get "$INIT" branching_strategy)
```

**NEW (allowed):**

```bash
node "$CLAUDE_PROJECT_DIR/.claude/gsd-ng/bin/gsd-tools.cjs" init-get-from-file $TMPDIR/execute-phase-init.json branching_strategy > $TMPDIR/execute-phase-branching.txt
read BRANCHING_STRATEGY < $TMPDIR/execute-phase-branching.txt
```

**Rationale:** `read VAR < file` is a shell builtin — no command
substitution. The dedicated `init-get-from-file` subcommand wraps
`init-get` with a file-source argument, eliminating the need for a
`$(...)` capture upstream.

### Pattern C — kill the ${CLAUDE_PROJECT_DIR:-$(...)} shim

**Replaces:**
`${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/...`
— denied because BOTH `${VAR:-default}` AND `$(...)` are hook-flagged.

**OLD (denied):**

```bash
node "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/gsd-ng/bin/gsd-tools.cjs" detect-workspace
```

**NEW (allowed) — source uses literal `./.claude/`; install.js rewrites at install time:**

```bash
node "./.claude/gsd-ng/bin/gsd-tools.cjs" detect-workspace
```

For deployed bash blocks: `install.js:copyWithPathReplacement` rewrites
`./.claude/` to `$CLAUDE_PROJECT_DIR/.claude/` (local installs) or
`$HOME/.claude/` (global installs). Both forms are hook-safe — plain
`$VAR` (no operator) is allowed.

**Rationale:** The hook only flags `${VAR:-default}` (with-operator)
parameter expansion. Plain `${VAR}` and `$VAR` are allowed. Bake the path
resolution into install-time, not runtime, so the deployed bash blocks
contain only hook-safe references.

### Pattern D — empty / literal defaults

**Replaces:** `${VAR:-}` / `${VAR:-/literal}` / `${VAR:-$(cmd)}` — all
denied because `:-` is the with-operator form.

**OLD (denied):**

```bash
ORIGIN_TODO_FILE="${ORIGIN_TODO_FILE:-}"
TMP="${TMPDIR:-/tmp}"
FOO="${FOO:-$(some-cmd)}"
```

**NEW (allowed):**

```bash
ORIGIN_TODO_FILE=""
TMP="$TMPDIR"
some-cmd > $TMPDIR/foo.txt
read FOO < $TMPDIR/foo.txt
[ -z "$FOO" ] && FOO="<fallback-literal>"
```

**Rationale:** Plain assignment `VAR=""` is not parameter expansion. Plain
`$VAR` is allowed — the hook checks for the `:` operator (`:-`, `:+`,
`:?`, `:=`) inside `${...}`. For dynamic-default cases, decompose into
redirect-then-read with explicit `[ -z "$VAR" ]` fallback.

### Pattern E — pipeline via temp files (preferred: existing subcommand)

**Replaces:** `VAR=$(grep ... | sed ...)` — denied because `$(...)` is
hook-flagged.

**OLD (denied):**

```bash
VERSION=$(grep '^version:' notes.md | sed 's/.*: *//')
```

**NEW (allowed) — preferred, use an existing subcommand:**

```bash
node "./.claude/gsd-ng/bin/gsd-tools.cjs" frontmatter get notes.md --field version > $TMPDIR/version.txt
read VERSION < $TMPDIR/version.txt
```

**NEW (allowed) — fallback, redirect-then-read sequential:**

```bash
grep '^version:' notes.md > $TMPDIR/version-line.txt
sed 's/.*: *//' $TMPDIR/version-line.txt > $TMPDIR/version.txt
read VERSION < $TMPDIR/version.txt
```

**Pattern E variant — `printf -v` for inline scalar formatting:** when
the assignment target is a known variable already in scope (e.g. `PHASE`),
the bash builtin `printf -v` writes formatted output directly to the
variable without a subshell — no temp file roundtrip:

```bash
printf -v PHASE '%02d' "$PHASE"
```

**Pattern E variant — `sed -e` chaining over multi-process pipelines:**
keep template substitutions inside one `sed` process so the only
capture is a single redirect-then-read:

```bash
printf '%s' "$TEMPLATE" | sed -e 's/{phase}/01/' -e 's/{slug}/foo/' > $TMPDIR/branch-name.txt
read BRANCH_NAME < $TMPDIR/branch-name.txt
```

**Rationale:** Pipelines themselves are fine; the hook only flags the
`$(...)` that captures their output. Decompose into sequential
redirect-then-read steps. When a dedicated `gsd-tools` subcommand exists
for the extraction (e.g. `frontmatter get --field`, `generate-slug`),
prefer it — fewer steps and clearer intent.

### Pattern F — replace inline `node -e` with `--field` extension

**Replaces:** `FOO=$(node -e "...{...}...")` — denied because `$(...)` AND
single-quoted braces (the `{...}` inside `process.stdout.write(...)` etc.)
trip the obfuscation guard.

**OLD (denied):**

```bash
SUBMODULE_PATHS=$(node -e "try{const w=JSON.parse(process.argv[1]);process.stdout.write((w.submodule_paths||[]).join(', ')||'none')}catch{process.stdout.write('none')}" "$WORKSPACE_JSON")
```

**NEW (allowed) — add a `--field` branch in `bin/lib/workspace.cjs` and use the existing dispatcher:**

```bash
node "./.claude/gsd-ng/bin/gsd-tools.cjs" detect-workspace --field submodule_paths_summary > $TMPDIR/submodule-paths.txt
read SUBMODULE_PATHS < $TMPDIR/submodule-paths.txt
```

**Pattern F variant — state-load hoist for nested config fields:** if
the value lives under a nested key in `config.json`, hoist the field to
`cmdStateLoad`'s top-level return shape in `bin/lib/state.cjs` AND
register a default in `INIT_FIELD_DEFAULTS` in `bin/lib/init.cjs`. Then
callers do `state load > tmp; init-get-from-file tmp <field>` with no
inline JS. Example: `model_profile` is hoisted via this exact recipe.

**Rationale:** Inline `node -e` scripts cannot avoid braces if they
manipulate JSON. Promote the logic to a new `--field <name>` branch in
the appropriate `lib/*.cjs` (no new top-level command needed — the
`--field` dispatcher handles new field names automatically). The deployed
bash block now contains only hook-safe shell.

### Pattern G — escape hatch (when no canonical helper fits)

A small number of cases legitimately can't use Patterns A-F:

1. **Regex-extract a free-form value from prose** that no `--field` or
   `--pick` accessor covers (e.g. discuss-phase pulls `Requirements:`
   lines and `Phase N` references out of freeform ROADMAP body text).
2. **Bridge to a Claude-specific runtime artifact** (e.g.
   check-todos reads the statusline state file path that only Claude
   Code emits).

**Escape hatch:**

```bash
GSD_HOOK_ALLOW_EXPANSION=1 bash -c 'FOO=$(some-irreducible-pipeline)'
```

Or, in workflow source, mark the surviving `$()` with a
`# TODO(60.1-PATTERN-G): see Plan 08 catalog — <one-line rationale>`
comment so future maintainers can audit whether a `--field` branch should
be added.

**Rationale:** The hook always honours `GSD_HOOK_ALLOW_EXPANSION=1`
(checked at the top of `detectForcedPromptPattern`). This is the
documented escape hatch for cases where Patterns A-F genuinely don't
apply — but it should be rare, and every use must carry a TODO comment
explaining why a canonical helper isn't viable.

### Pattern bonus — multi-line commit message via file

**Replaces:** `git commit -m "$(printf 'foo\n\nbar\n')"` — denied because
`$(...)` is hook-flagged.

**OLD (denied):**

```bash
git commit -m "$(printf 'feat: foo\n\nDetails here\n')"
```

**NEW (allowed) — preferred, use gsd-tools commit (handles attribution):**

```bash
node "./.claude/gsd-ng/bin/gsd-tools.cjs" commit "feat: foo" --files <files...>
```

**NEW (allowed) — fallback, write message to a file:**

```bash
printf 'feat: foo\n\nDetails here\n' > $TMPDIR/commit-msg.txt
git commit -F $TMPDIR/commit-msg.txt
```

**Rationale:** `git commit -F <file>` reads the message body from a
file — no shell expansion needed. The Bash tool's command line is what
gets hook-scanned; file contents are invisible to the hook.

### Pattern bonus — arithmetic without `$((...))`

**Replaces:** `$((expr))` — denied because the `$(` prefix triggers the
hook even when the second character is `(` (arithmetic) rather than
another character (cmd-subst).

**OLD (denied):**

```bash
SUFFIX=$((SUFFIX+1))
```

**NEW (allowed):**

```bash
(( SUFFIX++ )) || true
```

**Rationale:** Bash's `(( ... ))` arithmetic-evaluation form has no
leading `$` — the hook's `$(` check doesn't fire. The `|| true` handles
the case where the result is 0 (which causes `(( ))` to return exit 1).

## Testing

Unit tests for decomposition, matching, and decision logic live in
`tests/bash-hook.test.cjs` (166 tests across 30 suites as of 2026-04-18).
Integration tests for the install-time allowlist generation live in
`tests/allowlist.test.cjs` (33 tests across 7 suites).

Run both before any changes to the hook or allowlist:

```sh
node --test tests/bash-hook.test.cjs tests/allowlist.test.cjs
```

## Files to know

| File                                     | Purpose                                                    |
| ---------------------------------------- | ---------------------------------------------------------- |
| `hooks/bash-safety-hook.cjs`             | The hook itself (decomposition, matching, decision)        |
| `gsd-ng/templates/settings-sandbox.json` | Default allow entries shipped with Claude runtime install  |
| `bin/lib/allowlist.cjs`                  | Per-CLI granular pattern generator                         |
| `bin/install.js`                         | Merges template + detected CLI patterns into user settings |
| `tests/bash-hook.test.cjs`               | Hook unit tests                                            |
| `tests/allowlist.test.cjs`               | Generator tests                                            |
