---
name: gsd:divergence
description: Track upstream fork divergence and triage pending commits
argument-hint: "[--refresh] [--init] [--triage <hash> --status <status> --reason \"text\"] [--remote <name>] [--remote-branch <branch>]"
allowed-tools:
  - Read
  - Bash
  - Write
---
<objective>
Show upstream divergence status and manage per-commit triage decisions. Tracks which upstream commits have been picked, skipped, or deferred with rationale. Supports configurable remote name and branch (defaults to upstream/main).
</objective>

<process>

<step name="check_divergence">
Run the divergence command:

```bash
GSD_TOOLS="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/gsd-ng/bin/gsd-tools.cjs"
RESULT=$(node "$GSD_TOOLS" divergence)
if [[ "$RESULT" == @file:* ]]; then RESULT=$(cat "${RESULT#@file:}"); fi
```

Parse JSON output. If `status` is `no_upstream`, inform user they need to add an upstream remote:
```
git remote add upstream <upstream-url>
```

Present divergence summary showing pending/picked/skipped/deferred counts and the full commit list.

For commits needing triage, offer to update their status:
- `picked` — cherry-picked into this fork; reason optional
- `skipped` — intentionally excluded; reason REQUIRED
- `deferred` — to be decided later; reason REQUIRED

Update triage status with:
```bash
node "$GSD_TOOLS" divergence --triage <hash> --status <status> --reason "rationale"
```

To fetch latest upstream changes before checking:
```bash
node "$GSD_TOOLS" divergence --refresh
```

To initialize DIVERGENCE.md with the full upstream commit inventory:
```bash
node "$GSD_TOOLS" divergence --init
```

To track divergence against a different remote (instead of the default `upstream`):
```bash
node "$GSD_TOOLS" divergence --remote origin
```

To use a different remote branch (instead of the default `main`):
```bash
node "$GSD_TOOLS" divergence --remote origin --remote-branch develop
```

Both flags also work with `--init` and `--refresh`:
```bash
node "$GSD_TOOLS" divergence --init --remote origin --remote-branch develop
```
</step>

</process>
