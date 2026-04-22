# Changelog

All notable changes to gsd-ng will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- Phase 54 + 54.1 — Allowlist hardening rework (ALLOW-01..22):
  - `RW_FORMS` frozen-Set export in `allowlist.cjs`; `install.js` and `commands.cjs` consume this canonical source for bare/glob Edit/Write/Read permission forms
  - `getReadEditWriteAllowRules(platform)` pure function down-converts to bare `Edit/Write/Read` on Linux (workaround for claude-code #16170/#6881) and keeps canonical `Edit(*)/Write(*)/Read(*)` on macOS
  - `CLI_SUBCOMMANDS` narrowed from blanket `cli repo *` / `cli label *` patterns to explicit two-token verb entries (`view`, `list`, `clone`, `fork`, `create`, etc.) across `gh/glab/fj/tea` — destructive verbs (`delete`, `rename`, `edit`, `archive`) now fall through to prompting
  - `fj` no longer has `label` permission patterns (corrects Phase 54 ALLOW-14 drift — the `fj` CLI has no `label` subcommand)
  - `install.js` permission seeding split into independent `allow`/`deny`/`ask` section handlers (`deny`/`ask` infrastructure-ready for future template entries)
  - `generate-allowlist --platform <linux|darwin>` accepts explicit platform flag; output is set-equal to `install.js --local` seeding per platform
  - PERM-06 test strengthened to a two-sided contract (canonical forms present AND bare forms absent)
- Phase 52 — AST safety hook with rule modernization, shared rule templates, install-time injection
- Phase 47 — CLI output refactor and workflow bash simplification
- Phase 46 — Discuss-phase gap detection and plan-checker coverage improvements
- Phase 45 — E2E smoke test suite, dynamic UID fix, `--current` filter tests
- Phase 44 — CLI argument validation (`--flag` parsing, typo suggestions) and snapshot commands
- Phase 43 — Related-todo frontmatter tags with health checks (W021/W022), `--format newline` flag, repair handlers
- Phase 42 — `--field` extraction, SSH check, ambiguous fallback, UID fix in init; create-pr/execute-phase/squash refactored to use `$INIT` fields
- Phase 41 — Submodule-aware git operations: workspace topology detection, per-submodule config, `EFFECTIVE_TARGET_BRANCH` routing
- Phase 40 — Security hardening with prompt injection defense
- Phase 39 — Content optimization: 3-tier reference splits, shared ask-user-question and agent-shared-context references, philosophy condensation, behavioral benchmark tasks
- Install-time templating engine (`fillBetweenMarkers`) and AskUserQuestion first-turn injection
- `defaults.cjs` and `template-processor.cjs` with shared AST safety injection
- `init-get` CLI command with `gsd-tools` dispatch, replacing all `node -e` one-liners
- `init-valid` guard with self-recovery block across 26 workflows
- SECURITY.md with responsible disclosure policy
- VERSIONING.md documenting release strategy
- CI/CD workflows — cross-platform tests on PRs, GitHub Release with tarball on tag, npm publish via OIDC trusted publisher
- Branch protection rulesets for main and develop (squash-only, PR required), tag protection for `v*` and `gsd/*`

### Changed
- `install.js` permission seeding now emits one log line per section (`Added N allow entries`, `Added N deny rules`, `Added N ask entries`) instead of a single combined `Seeded N permissions` line. The no-op path (`Permissions already up to date`) is unchanged. Any downstream tooling that screen-scrapes installer output will need to adapt.
- Template `settings-sandbox.json` now ships canonical `Edit(*)/Write(*)/Read(*)` forms; `install.js` down-converts to bare `Edit/Write/Read` on Linux at install time via `getReadEditWriteAllowRules`. Existing user installs keep their previous forms until the Phase 57 `--clean` migration.
- Windows (`win32`) currently ships canonical glob RW forms (same as macOS) pending Claude Code Windows permission-engine validation. If Windows users hit Linux-style permission warnings, this will be revisited.
- Deduplicated AST safety rules into single template
- Wired `defaults.cjs` into config, core, init, verify, workspace modules
- Removed stale Windows references and guards

### Removed
- `install.js --config-dir` / `-c` CLI flag removed (quick task 260422-jai). Custom config directories are still supported via the `CLAUDE_CONFIG_DIR` / `COPILOT_CONFIG_DIR` environment variables. Users with `--config-dir` in install scripts must switch to the env-var form.

### Fixed
- Debug session false positive and create-pr collision guard
- `PUSH_TARGET` and `PR_TEMPLATE_PATH` in create-pr workflow
- Triple guard on `EFFECTIVE_TARGET_BRANCH` block
- Ambiguous path handling in init execute-phase and milestone-op output
- Orphaned closing tags and empty headings in checkpoint reference files

## [1.0.0-dev.3] - 2026-03-28

### Fixed
- GitHub Release workflow creates release as draft first, then publishes (workaround for immutable release tag constraint)

## [1.0.0-dev.2] - 2026-03-28

### Fixed
- Added `npm install -g npm@latest` to publish workflow for OIDC token support

## [1.0.0-dev.1] - 2026-03-28

### Added
- Security module — input validation and injection prevention across state and config operations
- Path consolidation — centralized planning path helper replacing 98 inline calls
- Multi-runtime support — Copilot CLI as second runtime alongside Claude Code, with content conversion engine and E2E tests
- Sandbox permission seeding — automatic safe permissions on install, cleanup on uninstall
- Divergence tracking — upstream fork comparison with configurable remote
- Benchmark harness — synthetic fixture project, 15 task definitions, structural and LLM-as-judge evaluators
- CLI improvements — subcommand suggestions, flag-style args, typo detection, guard routing
- Quick mode flags — `--verify` and `--all` for quick task workflow
- Hook integration test harness with schema validation
- Sandbox adaptation — graceful handling of blocked tool calls
- Tarball distribution — offline installer, build script, GitHub Actions release workflow
- 24 upstream cherry-picks through v1.22.4

### Changed
- Source directory and npm package renamed to gsd-ng
- Installer banner with NG block art
- Fork ownership updated

### Fixed
- Hook output format compliance across all hooks
- EPIPE crash and slug max length in CLI
- Command injection in `isGitIgnored`
- 5 pre-existing test failures in dispatcher and state
