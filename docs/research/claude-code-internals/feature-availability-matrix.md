# Claude Code Feature Availability Matrix

Cross-reference of when thinking, effort, and prompt-related features were introduced, removed, or changed across Claude Code versions. Compiled from official changelogs, Piebald-AI system prompt tracking, and source code analysis.

**Research date:** 2026-04-13

---

## Thinking & effort features

| Feature | Introduced | Source |
|---------|-----------|--------|
| Opus 4.6 launch + adaptive thinking API | 2026-02-09 (model-level) | [Anthropic blog](https://www.anthropic.com/news/claude-opus-4-6) |
| `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` env var | **At or before v2.1.63** (Feb 28) | Source analysis of [v2.1.63 bundle](versions/v2.1.63-thinking-config-analysis.md) |
| `CLAUDE_CODE_DISABLE_THINKING` env var | At or before v2.1.63 | Source analysis of v2.1.63 bundle |
| Medium effort default for Opus 4.6 | v2.1.68 (2026-03-04) | [Threads post](https://www.threads.com/@george_sl_liu/post/DVdr1SSk2HV/), Piebald tracking |
| "ultrathink" keyword reintroduced | v2.1.68 (2026-03-04) | Same changelog entry |
| `/effort` command (low/medium/high) | v2.1.72 (2026-03-10) | [Official changelog](https://code.claude.com/docs/en/changelog) |
| `/effort` as formal slash command | v2.1.76 (2026-03-14) | Official changelog |
| `showThinkingSummaries` setting | v2.1.89 (2026-04-01) | Official changelog |
| Default effort → high for API/Team/Enterprise | v2.1.94 (2026-04-08) | Official changelog |

## System prompt changes

| Feature | Introduced | Removed | Re-added | Removed again | Source |
|---------|-----------|---------|----------|---------------|--------|
| Output efficiency section | v2.1.64 (Mar 3) | v2.1.66 (Mar 4) | v2.1.69 (Mar 5) | v2.1.100 (Apr 10) | [Piebald-AI releases](https://github.com/Piebald-AI/claude-code-system-prompts/releases), [full timeline](output-efficiency-timeline.md) |

## Security features

| Feature | Introduced | Source |
|---------|-----------|--------|
| `tree-sitter-bash.wasm` in bundle | At or before v2.1.63 | Package inspection |
| CVE-2025-66032 fix (allowlist approach) | v1.0.93 | [NVD](https://nvd.nist.gov/vuln/detail/CVE-2025-66032) |
| 50-subcommand limit bypass fix | v2.1.90 (2026-04-02) | [Adversa.ai](https://adversa.ai/blog/claude-code-security-bypass-deny-rules-disabled/) |
| Prompt caching bug fixes | v2.1.88 (2026-03-31) | Official changelog |

---

## Version decision matrix

For users choosing which version to run, considering the tradeoffs:

| If you want... | Minimum version | Notes |
|-----------------|----------------|-------|
| No Output efficiency prompt | v2.1.63 or earlier; or v2.1.100+ | v2.1.66–v2.1.68 is a brief gap too |
| Disable adaptive thinking | v2.1.63+ | Env var already exists in v2.1.63 |
| `/effort` control | v2.1.72+ | Formal slash command from v2.1.76 |
| `effortLevel` in settings.json | v2.1.76+ | Persists across sessions |
| `showThinkingSummaries` | v2.1.89+ | Thinking hidden by default from this version |
| All security patches (as of Apr 13) | v2.1.104 | Latest at time of research |
| Avoid ~20K token inflation | v2.1.98 or earlier; or unverified on v2.1.104 | [#46917](https://github.com/anthropics/claude-code/issues/46917) |

### Recommended configuration (stay current + tune settings)

Rather than downgrading, configure the latest version:

```json
// ~/.claude/settings.json
{
  "effortLevel": "high",
  "showThinkingSummaries": true,
  "env": {
    "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING": "1"
  }
}
```

This gives you: high effort + fixed thinking budgets + visible thinking summaries + all security patches. Add a CLAUDE.md override to counteract the Output efficiency strategy directives if still present in your version.

---

## What v2.1.63 source analysis proved

From [v2.1.63-thinking-config-analysis.md](versions/v2.1.63-thinking-config-analysis.md):

1. **v2.1.63 sends `thinking: { type: "adaptive" }` by default** for Opus 4.6. There is no version of Claude Code post-Opus-4.6 that avoids adaptive thinking without `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`.

2. **The effort budget function in v2.1.63 only checks a server-side feature flag** (`tengu_crystal_beam`), not user-configurable effort. The effort concept (`low`/`medium`/`high`) was added in v2.1.68+.

3. **`CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING` already works in v2.1.63.** It forces fallback to `{ type: "enabled", budget_tokens: N }` with a fixed budget.

4. **`tree-sitter-bash.wasm` is already bundled in v2.1.63.** AST-based bash command parsing predates this version.

---

## References

- [v2.1.63 thinking config analysis](versions/v2.1.63-thinking-config-analysis.md) — Source code reverse-engineering
- [Output efficiency timeline](output-efficiency-timeline.md) — Prompt addition/removal tracking
- [Token inflation analysis](token-inflation-46917.md) — #46917 deep dive
- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) — Automated prompt tracking
- [Official Claude Code changelog](https://code.claude.com/docs/en/changelog)
- [claude-performance-troubleshooting.md](../../claude-performance-troubleshooting.md) — Parent troubleshooting document
