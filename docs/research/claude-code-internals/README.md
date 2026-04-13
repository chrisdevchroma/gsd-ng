# Claude Code Performance Research

Independent research into Claude Code's thinking configuration, token consumption, and system prompt behavior. Conducted 2026-04-13 via source code analysis, issue investigation, and system prompt tracking.

---

## Summary of findings

### 1. Adaptive thinking is inescapable without the env var

Static analysis of the v2.1.63 minified bundle proves that **every version of Claude Code since Opus 4.6 (Feb 9, 2026) sends `thinking: { type: "adaptive" }` by default**. The `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` env var exists as early as v2.1.63 (Feb 28) and is the only user-accessible way to force fixed thinking budgets. Downgrading does not escape adaptive thinking.

### 2. Three confounded changes caused the Mar 2026 regression

The quality regression reported in [#42796](https://github.com/anthropics/claude-code/issues/42796) (6,852 sessions, 234,760 tool calls) is the compound effect of three changes that landed in the same window:

1. **Adaptive thinking default** (Feb 9) — model decides per-turn how deeply to think, sometimes under-budgeting
2. **Medium effort default** (Mar 3, v2.1.68) — `effort=85` reduced thinking budgets
3. **Output efficiency prompt** (Mar 3, v2.1.64) — includes unscoped strategy directives ("try the simplest approach first", "do not overdo it") that steer the model toward shallow solutions

Anthropic's official response ([bcherny on #42796](https://github.com/anthropics/claude-code/issues/42796)) attributes the regression to (1) and (2). The Output efficiency section is a plausible contributor via its strategy directives, but its individual impact cannot be isolated from the other two changes.

### 3. Server-side token inflation is real and version-specific

[#46917](https://github.com/anthropics/claude-code/issues/46917) documents ~20K extra `cache_creation_input_tokens` per request in v2.1.100+ vs v2.1.98. This is server-side (client payload was actually smaller), enters the context window (not just billing), and represents ~40% overhead on a clean project. A User-Agent header override was suggested but remains unconfirmed. Version downgrade to v2.1.98 is the confirmed workaround, subject to server-side minimum version enforcement.

### 4. The "internal vs external prompt" claim is unverified

Claims that Anthropic uses a different, superior internal prompt have no verified source. The March 31 leak revealed one prompt, not a comparison.

---

## Documents

| Document | Description |
|----------|-------------|
| [v2.1.63-thinking-config-analysis.md](versions/v2.1.63-thinking-config-analysis.md) | Full source code analysis of v2.1.63's thinking parameter construction, with deobfuscated code snippets and decision tree |
| [output-efficiency-timeline.md](output-efficiency-timeline.md) | Version-by-version tracking of the Output efficiency prompt's addition, removal, and re-addition, plus analysis of its two types of directives |
| [token-inflation-46917.md](token-inflation-46917.md) | Deep dive into #46917's token inflation data, User-Agent workaround assessment, and version downgrade constraints |
| [feature-availability-matrix.md](feature-availability-matrix.md) | Cross-reference of when thinking, effort, prompt, and security features landed across versions, with a practical decision matrix |

---

## Recommended configuration

For users wanting maximum reasoning quality on the latest version:

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

Optionally, add a CLAUDE.md override to counteract the Output efficiency strategy directives:

```markdown
When facing complex tasks: read all relevant files before editing, consider edge
cases, validate the design before coding. Do not default to the simplest approach —
default to the correct approach, even when it takes longer. If unsure, investigate
rather than guess.
```

---

## Parent document

These research notes feed into [claude-performance-troubleshooting.md](../../claude-performance-troubleshooting.md), the main reference document for diagnosing and working around Claude Code behavior issues.
