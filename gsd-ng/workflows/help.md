<purpose>
Display the complete GSD command reference. Output ONLY the reference content. Do NOT add project-specific analysis, git status, next-step suggestions, or any commentary beyond the reference.
</purpose>

<required_reading>
Read all files referenced by the invoking prompt's execution_context before starting.
</required_reading>

<process>

<step name="get_commands">
Retrieve the command list:

```bash
mkdir -p $TMPDIR
node "$GSD_TOOLS" help --json > $TMPDIR/help-output.json
```

Read `$TMPDIR/help-output.json` and parse it. The `commands` array contains objects with `name`, `description`, and `argument_hint` fields.
</step>

<step name="present_help">
Present the command reference to the user:

# GSD Command Reference

**GSD** (Get Shit Done) creates hierarchical project plans optimized for solo agentic development with Claude Code.

## Quick Start

1. `{{COMMAND_PREFIX}}new-project` - Initialize project (includes research, requirements, roadmap)
2. `{{COMMAND_PREFIX}}plan-phase 1` - Create detailed plan for first phase
3. `{{COMMAND_PREFIX}}execute-phase 1` - Execute the phase

## Staying Updated

```bash
npx gsd-ng@latest
```

## Available Commands

List all commands from the JSON output, grouped by category if the name suggests one (e.g., project lifecycle, phase management, collaboration, utilities). Format each as:

`/{name}` — {description} {argument_hint if present}

If the JSON contains no commands (error case), fall back to displaying this message:
"Could not auto-discover commands. Run `node ~/.claude/gsd-ng/bin/gsd-tools.cjs help` to debug."
</step>

</process>
