# Contributing to gsd-ng

Thanks for contributing. gsd-ng is a Claude Code-focused fork of get-shit-done. See [README.md](README.md) for getting started and [SECURITY.md](SECURITY.md) for security reporting.

## Repo layout

- `gsd-ng/workflows/` — orchestrator workflow prompts (`/gsd:execute-phase`, `/gsd:plan-phase`, etc.)
- `gsd-ng/references/` — workflow reference snippets loaded via `@`-includes
- `agents/` — typed subagent prompts (planner, executor, verifier, etc.)
- `commands/gsd/` — Claude Code command shims that point at workflows
- `bin/` — `install.js` + `gsd-tools.cjs` entry points
- `bin/lib/` — `gsd-tools.cjs` subcommand implementations
- `hooks/` — PreToolUse / Stop hook scripts (`bash-safety-hook.cjs`, `context-monitor`, etc.)
- `scripts/` — repo build / lint / coverage scripts
- `tests/` — `node --test` suites
- `docs/` — architecture and reference documentation

## Running tests

```bash
npm test                # full suite
npm run test:coverage   # with c8 coverage (per-file gate)
node --test tests/bash-hook.test.cjs   # single file, fast feedback
```

The coverage suite enforces ≥95% line / ≥90% branch / ≥80% function coverage per `bin/lib/*.cjs` module (see `scripts/coverage-gate.cjs`). A baseline-cap check (`tests/c8-ignore-lint.test.cjs`) prevents new `c8-ignore` directives from silently widening the exemption — add a justified entry to `tests/c8-ignore-baseline.json` if you legitimately need one.

## The bash-safety hook

The repo ships a PreToolUse hook (`hooks/bash-safety-hook.cjs`) that gates `Bash` tool calls through an allowlist with subshell decomposition and wrapper-bypass detection. If a commit's tests pass locally but fail in CI on a hook denial, see [docs/bash-safety-hook.md](docs/bash-safety-hook.md) for the deny/allow algorithm and how to debug a specific command.

## Commit message style

Use [`gsd-tools.cjs commit "<msg>" --files <files...>`](bin/gsd-tools.cjs) — handles attribution and co-author lines.

Prefix conventions follow [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `refactor:`, `docs:`, `test:`, `chore:`. Optional scope in parens describes the module touched, not internal task tracking — e.g. `feat(hook):`, `fix(install):`, `test(coverage):`.

See [VERSIONING.md](VERSIONING.md) for the release / changelog flow.

## Reporting issues

- Bugs and feature requests: GitHub Issues.
- Security: see [SECURITY.md](SECURITY.md).
