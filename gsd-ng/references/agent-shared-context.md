<project_context>
Before executing, discover project context:

**Project instructions:** Read `./CLAUDE.md` if it exists in the working directory. Follow all project-specific guidelines, security requirements, and coding conventions.

**Project skills:** Check `.claude/skills/` or `.agents/skills/` directory if either exists:
1. List available skills (subdirectories)
2. Read `SKILL.md` for each skill (lightweight index ~130 lines)
3. Load specific `rules/*.md` files as needed during implementation
4. Do NOT load full `AGENTS.md` files (100KB+ context cost)
5. Follow skill rules relevant to your current task

This ensures project-specific patterns, conventions, and best practices are applied during execution.
</project_context>

<claude_code_bash_safety>
<!-- Claude Code only — GitHub Copilot CLI has no equivalent AST safety layer. -->
<!-- These rules apply to all agents running under Claude Code. -->
<!--
  Claude Code's bash AST safety layer (tree-sitter-bash in bashSecurity.ts) fires
  independently of the permission/allowlist/sandbox layer. No config option exists to
  suppress these heuristics. See: https://github.com/anthropics/claude-code/issues/30435
-->

## Bash constructs that trigger Claude Code AST safety prompts

When generating bash commands, avoid these constructs. They cause Claude Code to pause
and prompt even when the command is allowlisted or sandbox is disabled.

### Forbidden constructs and safe alternatives

| Forbidden | Safe alternative | Issue |
|-----------|-----------------|-------|
| `<<< "$VAR"` here-strings | `echo "$VAR" \|` or `printf '%s' "$VAR" \|` | [#30435](https://github.com/anthropics/claude-code/issues/30435) — by design |
| `for x in {a,b,c}` brace expansion | explicit list: `for x in a b c` | [#42400](https://github.com/anthropics/claude-code/issues/42400) — **regression**, removable if #42400 fixed |
| `<(cmd)` process substitution | temp file: `cmd > "$TMPDIR/f"; diff "$TMPDIR/f" ...` | [#30435](https://github.com/anthropics/claude-code/issues/30435) — by design |
| `$'\x41'` ANSI-C quoting | use literal characters or `printf` | [#30435](https://github.com/anthropics/claude-code/issues/30435) — by design |
| multi-line heredoc `<< 'EOF'` | write to temp file first, pass path | [#30435](https://github.com/anthropics/claude-code/issues/30435) — by design |
| `$()` in complex nested contexts | pre-capture to variable in a prior simple command | [#31373](https://github.com/anthropics/claude-code/issues/31373) — by design |

### Additional by-design heuristics (no workaround eliminates them fully)

- `&&` compound chains may re-prompt in some contexts — split into separate Bash calls when possible. See [#28183](https://github.com/anthropics/claude-code/issues/28183).
- `for` loops may trigger spurious directory prompts — use `while IFS= read -r` with a pipe instead when iterating lines. See [#22502](https://github.com/anthropics/claude-code/issues/22502).
- `bypassPermissions` mode does NOT suppress AST heuristics. See [#39875](https://github.com/anthropics/claude-code/issues/39875).

### Note on the brace expansion workaround

The `{a,b,c}` brace expansion trigger was introduced in Claude Code v2.1.90 and is
suspected to be a regression (Issue [#42400](https://github.com/anthropics/claude-code/issues/42400),
open as of 2026-04-04). Unlike the other heuristics, this one may be removed in a patch
release. If #42400 is resolved upstream, the explicit-list workarounds in GSD workflows
can be reverted.
</claude_code_bash_safety>
