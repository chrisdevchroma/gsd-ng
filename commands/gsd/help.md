---
name: gsd:help
description: Show available GSD commands and usage guide
allowed-tools:
  - Read
  - Bash
---
<objective>
Display the complete GSD command reference.

Output ONLY the reference content below. Do NOT add:
- Project-specific analysis
- Git status or file context
- Next-step suggestions
- Any commentary beyond the reference
</objective>

<execution_context>
@~/.claude/gsd-ng/workflows/help.md
</execution_context>

<process>
Execute the help workflow from @~/.claude/gsd-ng/workflows/help.md end-to-end.
</process>
