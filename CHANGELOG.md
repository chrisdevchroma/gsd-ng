# Changelog

All notable changes to gsd-ng will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

Forked from [gsd-build/get-shit-done](https://github.com/gsd-build/get-shit-done) v1.22.4.

## [Unreleased]

### Added
- **CI/CD workflows** — test.yml (cross-platform CI on PRs to develop/main), release.yml (GitHub Release with tarball on tag), publish.yml (npm publish via OIDC trusted publisher)
- **GitHub branch protection** — rulesets for main (squash-only, 1 approval, linear history) and develop (squash-only, PR required), tag protection for v* and gsd/*

## [1.0.0-dev.1] - 2026-03-28

### Added
- **Security module** (phase 31) — `security.cjs` with `scanForInjection`, `validatePhaseNumber`, `validateFieldName`, `validatePath` wired into init, frontmatter, and state write operations
- **Path consolidation** (phase 32) — `planningPaths()` helper replacing 98 inline `path.join(.planning)` calls across 9 files, `extractCurrentMilestone`, `stateReplaceFieldWithFallback` with upsert semantics
- **Multi-runtime Copilot CLI support** (phase 36) — parameterized path functions for runtime selection, content conversion engine, copilot-instructions template, Copilot install/uninstall wiring with E2E tests, `--runtime` flag, `resolveTmpDir()` for sandbox compatibility
- **Sandbox permission seeding** (phase 35) — expanded `settings-sandbox.json` with Agent, Edit, Write, Skill, WebFetch, WebSearch permissions, permission seeding in `install()` with cleanup on uninstall
- **Divergence tracking** (phase 34) — `--remote` and `--remote-branch` flags for upstream mode in divergence command
- **Benchmark harness** (phase 38) — synthetic GSD fixture project, benchmark-config.json model registry, 15 benchmark task definitions, benchmark-runner.cjs CLI, structural evaluator, LLM-as-judge evaluator with 28 unit tests
- **CLI tooling** (phase 37) — dispatcher UX enhancements (flag-style args, typo detection, guard routing, roadmap alias), `gsd-tools guard sync-chain`, standalone bin/ scripts
- **SUBCOMMANDS registry** — `suggestSubcommand` helper wired into all 13 compound command branches
- **Quick mode flags** — `--verify` and `--all` flags for quick task workflow
- **Hook integration test harness** (phase 02) — `hook-harness.cjs` test helper with schema validation
- **Sandbox adaptation** (phase 03) — `sandbox-detect.js` PreToolUse hook, defensive write guards, graceful handling of blocked tool calls
- **Tarball distribution** (phase 04) — `build-tarball.js`, `install.py` Python offline installer, `GSD_OFFLINE` guard, GitHub Actions release workflow
- **Upstream cherry-picks** — 24 upstream PRs merged: decimal phase padding, canonical refs, node repair operator, quick timestamp IDs, codex agent TOML, Nyquist validation, note capture, freeform router, debug knowledge base, and more

### Changed
- Declared hard fork from upstream get-shit-done (2026-03-23)
- Renamed source directory `get-shit-done/` to `gsd-ng/`
- Renamed install directory from `~/.claude/get-shit-done/` to `~/.claude/gsd-ng/`
- Renamed npm package from `get-shit-done-cc` to `gsd-ng`
- Renamed sandbox-detect.js hook to `gsd-sandbox-detect.js` for consistent `gsd-*` prefix
- Updated all workflow, agent, command, and reference files to use gsd-ng/ paths
- Updated fork ownership — FUNDING.yml, CODEOWNERS
- NG block art added to installer banner

### Fixed
- `hookSpecificOutput` wrapper bug in all hooks (phase 01)
- PostToolUse output format compliance across all hooks
- EPIPE crash and slug max length in `core.cjs`
- Phase add/insert missing summary checkbox line
- `execSync` replaced with `execFileSync` in `isGitIgnored` to prevent command injection
- AskUserQuestion dialog occlusion in check-todos workflow
- 5 pre-existing test failures in dispatcher and state tests
- GPT-5.4/5.3-codex enabled as premium Copilot models

## [1.0.0] - 2026-03-15

### Changed
- Version reset to 1.0.0 — start of independent gsd-ng versioning lifecycle (forked from upstream v1.22.4)
