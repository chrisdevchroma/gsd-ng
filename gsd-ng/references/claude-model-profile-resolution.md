# Model Profile Resolution

Resolve model profile once at the start of orchestration, then use it for all Task spawns.

## Resolution Pattern

Load state once, then read `model_profile` from the JSON file using `init-get-from-file`. The helper hoists `model_profile` to a top-level field and falls back to `"balanced"` when config is missing or the field is unset, so no inline default is needed.

```bash
node ./.claude/gsd-ng/bin/gsd-tools.cjs state load > $TMPDIR/model-profile-state.json
node ./.claude/gsd-ng/bin/gsd-tools.cjs init-get-from-file $TMPDIR/model-profile-state.json model_profile > $TMPDIR/model-profile-value.txt
read MODEL_PROFILE < $TMPDIR/model-profile-value.txt
```

Default: `balanced` if not set or config missing (the helper handles this — `MODEL_PROFILE` is always populated).

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
