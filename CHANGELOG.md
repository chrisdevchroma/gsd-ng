# Changelog

All notable changes to gsd-ng will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added
- CI/CD workflows — cross-platform tests on PRs, GitHub Release with tarball on tag, npm publish via OIDC trusted publisher
- Branch protection rulesets for main and develop (squash-only, PR required), tag protection for v* and gsd/*

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

