<!-- GSD — AST Safety Rules (managed by get-shit-done installer) -->

## GSD — AST Safety Rules

Claude Code's bash AST safety layer (tree-sitter-bash in `bashSecurity.ts`) fires
independently of the permission/allowlist/sandbox layer. No config option exists to
suppress these heuristics. This block documents which bash constructs to avoid.
See: https://github.com/anthropics/claude-code/issues/30435

### Forbidden constructs and safe alternatives

| Forbidden | Safe alternative | Issue |
|-----------|-----------------|-------|
| `<<< "$VAR"` here-strings | `echo "$VAR" |` or `printf '%s' "$VAR" |` | [#30435](https://github.com/anthropics/claude-code/issues/30435) — by design |
| `for x in {a,b,c}` brace expansion | explicit list: `for x in a b c` | [#42400](https://github.com/anthropics/claude-code/issues/42400) — **regression**, removable if #42400 fixed |
| `<(cmd)` process substitution | temp file: `cmd > "$TMPDIR/f"` | [#30435](https://github.com/anthropics/claude-code/issues/30435) — by design |
| `$'\x41'` ANSI-C quoting | literal characters or `printf` | [#30435](https://github.com/anthropics/claude-code/issues/30435) — by design |
| multi-line heredoc `<< 'EOF'` | write to temp file first, pass path | [#30435](https://github.com/anthropics/claude-code/issues/30435) — by design |

### Note on brace expansion

<!-- AST safety: brace expansion {a,b,c} triggers sandbox prompts in Claude Code v2.1.90+
     (regression, may be fixed upstream — check #42400 before removing).
     See: https://github.com/anthropics/claude-code/issues/42400 -->

The `{a,b,c}` brace expansion trigger was introduced in v2.1.90 and is suspected to be a
regression (Issue [#42400](https://github.com/anthropics/claude-code/issues/42400)). If it
is fixed upstream, explicit-list workarounds in GSD workflows can be reverted.

<!-- /GSD — AST Safety Rules -->
