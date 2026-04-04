<!-- GSD — AST Safety Rules -->

## GSD — AST Safety Rules

Avoid these bash constructs — they trigger Claude Code's AST safety prompts.

| Avoid | Use instead |
|-------|-------------|
| `<<< "${VAR}"` | pipe via `echo "${VAR}"` or `printf '%s' "${VAR}"` |
| `{a,b,c}` brace expansion | `for x in a b c` (explicit list) |
| `<(cmd)` process substitution | `cmd > "${TMPDIR}/f"` |
| `$'\x41'` ANSI-C quoting | literal characters or `printf` |
| `<< 'EOF'` heredoc | write to temp file, pass path |
| nested `$()` | pre-capture to variable first |
| `&&` chains | split into separate Bash calls |
| `for` loops over variables | `while IFS= read -r` with pipe |

<!-- /GSD — AST Safety Rules -->
