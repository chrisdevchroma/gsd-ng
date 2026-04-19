# Model Profile Resolution

Resolve model profile once at the start of orchestration, then use it for all Task spawns.

## Resolution Pattern

```bash
MODEL_PROFILE=$(cat .planning/config.json 2>/dev/null | grep -o '"model_profile"[[:space:]]*:[[:space:]]*"[^"]*"' | grep -o '"[^"]*"$' | tr -d '"' || echo "balanced")
```

Default: `balanced` if not set or config missing.

## Lookup Table

@~/.claude/gsd-ng/references/claude-model-profiles.md

Look up the agent in the table for the resolved profile. Pass the model parameter to Task calls:

```
Task(
  prompt="...",
  subagent_type="gsd-planner",
  model="{resolved_model}"  # "opus", "sonnet", "haiku", or null
)
```

**Note:** `null` is returned only when `model_profile` is `inherit`. A `null` value causes the `model` parameter to be omitted from the Task call, so the spawned agent inherits the parent session's model. Agents with no `MODEL_PROFILES` row fall through to `'sonnet'` (a literal fallback, not null) — see the EFFORT/MODEL key parity test in `tests/config.test.cjs` that prevents this from happening accidentally.

## Usage

1. Resolve once at orchestration start
2. Store the profile value
3. Look up each agent's model from the table when spawning
4. Pass model parameter to each Task call (values: `"opus"`, `"sonnet"`, `"haiku"`, or `null` — null means omit the parameter)
