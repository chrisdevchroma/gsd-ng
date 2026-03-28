# GSD-NG Configuration

This project uses [GSD-NG](https://github.com/gsd-build/gsd-ng) for spec-driven development.

## Skills

GSD skills are available in the `skills/gsd-*/` directories. Use them by name (e.g., `gsd-new-project`, `gsd-plan-phase`).

## Agents

GSD agents are available in the `agents/` directory as `.agent.md` files.

## Workflows

The GSD workflow engine lives in `gsd-ng/workflows/`. Agents and skills reference these workflows automatically.

## Important

- Follow the workflow system — do not skip phases or bypass planning
- Use `gsd-ng/` for all GSD engine files
- The `.planning/` directory contains project state — read but do not manually edit
