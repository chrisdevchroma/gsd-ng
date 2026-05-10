# Contributing to gsd-ng

Thanks for contributing! gsd-ng is a Claude Code-focused fork of
get-shit-done. See [README.md](README.md) for getting started, and
[SECURITY.md](SECURITY.md) for security reporting.

## Repo layout

- `gsd-ng/workflows/` — orchestrator workflow prompts
  (`/gsd:execute-phase`, `/gsd:plan-phase`, etc.)
- `gsd-ng/references/` — workflow reference snippets loaded via
  `@`-includes
- `agents/` — typed subagent prompts (planner, executor, verifier, etc.)
- `commands/gsd/` — Claude Code command shims that point at workflows
- `bin/` — `install.js` + `gsd-tools.cjs` entry points
- `bin/lib/` — `gsd-tools.cjs` subcommand implementations
- `hooks/` — PreToolUse/Stop hook scripts (`bash-safety-hook.cjs`,
  `context-monitor`, etc.)
- `tests/` — `node --test` suites (~50+ test files)
- `docs/` — architecture / reference documentation

## Writing hook-safe workflows

The bash-safety hook (`hooks/bash-safety-hook.cjs`) denies common bash
patterns that trigger Claude Code's expansion guard — `$(...)` command
substitution, `${VAR:-default}` parameter expansion, backtick command
substitution, and single-quoted strings with non-quantifier braces. When
writing a `\`\`\`bash` block in any workflow / agent / command / reference
file, follow these rules:

- **NEVER** capture command output with `FOO=$(cmd)`. Instead:
  `cmd > $TMPDIR/foo.txt; read FOO < $TMPDIR/foo.txt`.
- **NEVER** use `${VAR:-default}` defensive defaults. Instead: plain
  `$VAR` + caller ensures it's set, OR
  `[ -z "$VAR" ] && VAR=fallback`.
- **NEVER** use backticks (`` `cmd` ``), even in BASH COMMENTS — the
  hook scans comments too.
- **NEVER** use `$((arith))` arithmetic — the `$(` prefix triggers the
  check. Instead: `(( arith )) || true`.
- **NEVER** put braces inside single-quoted strings unless they're regex
  quantifiers (`{0,80}`). Instead: write the script body to
  `$TMPDIR/script.awk` then `awk -f $TMPDIR/script.awk`.
- **NEVER** use the legacy
  `${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}/.claude/...`
  shim. Instead: literal `./.claude/...` (install.js rewrites at install
  time) OR `~/.claude/...` (install.js rewrites for both global + local).
- **PREFER** existing `gsd-tools.cjs` subcommands:
  `init-get-from-file <path> <field>`, `detect-workspace --field <name>`,
  `guard init-valid-file <path>`,
  `frontmatter get <path> --field <name>`,
  `commit "<msg>" --files ...`.

For the full catalog of canonical substitution patterns:
[docs/bash-safety-hook.md#pattern-catalog-for-hook-safe-workflow-authoring](docs/bash-safety-hook.md#pattern-catalog-for-hook-safe-workflow-authoring).

## Running tests

```bash
cd gsd-ng
npm test                # full suite (~17s)
npm run test:coverage   # with c8 coverage
node --test tests/bash-hook.test.cjs    # quick — hook tests only (~1s)
```

## Reporting issues

- Bugs / features: GitHub Issues.
- Security: see [SECURITY.md](SECURITY.md).

## Commit message style

- Use
  [`gsd-tools.cjs commit "<msg>" --files <files...>`](bin/gsd-tools.cjs)
  — handles attribution and co-author lines automatically.
- Prefix conventions: `feat(<phase>):`, `fix(<phase>):`,
  `refactor(<phase>):`, `docs(<phase>):`, `test(<phase>):`.
- See [VERSIONING.md](VERSIONING.md) for the release / changelog flow.
