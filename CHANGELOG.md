# Changelog

All notable changes to gsd-ng will be documented in this file.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

For the upstream changelog (gsd-build/get-shit-done v1.0.0–v1.22.4), see [CHANGELOG-upstream.md](CHANGELOG-upstream.md).

## [Unreleased]

### Changed
- Declared hard fork from upstream get-shit-done
- Renamed install directory from `~/.claude/get-shit-done/` to `~/.claude/gsd-ng/`
- Renamed npm package from `get-shit-done-ng` to `gsd-ng`
- Renamed sandbox-detect.js hook to `gsd-sandbox-detect.js` for consistent `gsd-*` prefix
- Updated all workflow, agent, command, and reference files to use gsd-ng/ paths

## [Unreleased (pre-fork)]

### Added
- **Node repair operator** (`workflows/node-repair.md`) — autonomous recovery when task verification fails. Instead of immediately asking the user, the executor attempts structured repair: RETRY (different approach), DECOMPOSE (break into sub-tasks), or PRUNE (skip with justification). Only escalates to the user when the repair budget is exhausted or an architectural decision is needed. Repair budget defaults to 2 attempts per task; configurable via `workflow.node_repair_budget`. Disable entirely with `workflow.node_repair: false` to restore original behavior.

### Fixed
- `/gsd:new-milestone` no longer overwrites `workflow.research` config — milestone research decision is now per-invocation, persistent preference only changes via `/gsd:settings`
- `/gsd:health --repair` now creates config.json with correct nested `workflow` structure matching `config-ensure-section` canonical format

## [1.0.0] - 2026-03-15

### Changed
- Version reset to 1.0.0 — start of independent gsd-ng versioning lifecycle (forked from upstream v1.22.4)
