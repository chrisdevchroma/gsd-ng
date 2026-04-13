# Server-Side Token Inflation — Issue #46917

Analysis of the ~20K invisible token inflation in Claude Code v2.1.100+, the User-Agent workaround hypothesis, and version downgrade constraints.

**Research date:** 2026-04-13
**Source issue:** [anthropics/claude-code#46917](https://github.com/anthropics/claude-code/issues/46917) — Open, 83 upvotes, assigned to @notitatall

---

## The problem

Claude Code v2.1.100+ silently adds ~20,000 extra `cache_creation_input_tokens` per request compared to v2.1.98, despite sending **fewer bytes** in the client payload. The inflation is entirely server-side and version-specific.

### Evidence table

Measured via HTTP proxy (`claude-code-logger@1.0.2`) capturing full request/response bodies. Each test: cold cache, single API call, no session state (`--print` mode), same machine, same account, minutes apart.

| Version | Content-Length (bytes) | cache_creation_input_tokens | cache_read | Total |
|---------|----------------------|----------------------------|------------|-------|
| v2.1.98 | 169,514 | **49,726** | 0 | 49,726 |
| v2.1.100 | 168,536 (−978 B) | **69,922** | 0 | 69,922 |
| v2.1.101 | 171,903 (+2,389 B) | ~72,000 | 0 | ~72,000 |

v2.1.100 sends 978 fewer bytes but is billed **20,196 more tokens**. Cross-account test (two Max accounts, same v2.1.98) showed < 500 token delta — rules out account-specific routing.

Interactive mode analysis across 40+ sessions shows bimodal distribution: ~50K (v2.1.98 baseline) vs ~71K (v2.1.100+), with some sessions starting cold at 71K with `cache_read=0` — confirming this is the baseline, not accumulated cache.

---

## Impact

- **~40% overhead** on a clean project
- Max plan users hit 5-hour cap significantly faster
- These are `cache_creation_input_tokens` — they enter the model's **context window**, not just the billing ledger
- Hidden server-injected content may compete with user-provided CLAUDE.md rules
- 20K fewer available for conversation history per turn (compounds in long sessions)
- Users cannot audit what the model "sees" vs what they sent

---

## Reproduction

```bash
# 1. Install proxy to capture full API request/response bodies
mkdir /tmp/cc-test && cd /tmp/cc-test
npx -y claude-code-logger@1.0.2 start --port 8000 --log-body --merge-sse

# 2. In another terminal — test with older version
export ANTHROPIC_BASE_URL="http://localhost:8000"
npx @anthropic-ai/claude-code@2.1.98 --print "1+1"
# Note cache_creation_input_tokens in response

# 3. Same setup — test with newer version
npx @anthropic-ai/claude-code@2.1.100 --print "1+1"
# Note cache_creation_input_tokens in response
```

---

## User-Agent workaround (speculative, unconfirmed)

Suggested by @fabifont in the issue comments. The hypothesis: Anthropic routes requests server-side based on the `User-Agent` header (which contains the CC version string), so spoofing it to v2.1.98 would avoid the extra injection.

```bash
# Via environment variable
export ANTHROPIC_CUSTOM_HEADERS='User-Agent: claude-cli/2.1.98 (external, sdk-cli)'
claude --print "1+1"
```

Or in `settings.json`:
```json
{
  "env": {
    "ANTHROPIC_CUSTOM_HEADERS": "User-Agent: claude-cli/2.1.98 (external, sdk-cli)"
  }
}
```

### Plausibility assessment

**Arguments for:**
- Issue author attributes inflation to "likely User-Agent routing" — the only variable between test runs was the CC version, and client payload was actually smaller in v2.1.100
- `ANTHROPIC_CUSTOM_HEADERS` is a documented Claude Code env var
- Server-side A/B routing by client version string is standard practice

**Arguments against:**
- Nobody in the issue thread confirmed actually testing the override and measuring the result
- [Separate research](https://gist.github.com/mrcattusdev/53b046e56b5a0149bdb3c0f34b5f217a) suggests Anthropic fingerprints clients via **system prompt content**, not HTTP headers — if injection is triggered by prompt matching, a header override alone would have no effect
- The SDK may set or override User-Agent internally after `ANTHROPIC_CUSTOM_HEADERS` is applied
- Spoofing version strings may have unintended side effects if the server uses User-Agent for feature gating

**Verdict:** Worth a quick test with the proxy, but don't assume it works without verifying. The downgrade workaround is the only confirmed fix.

---

## Version downgrade constraints

### Server-side minimum version enforcement

Claude Code checks a server-side minimum version on launch. If your version falls below the floor, it refuses to start:

> *"It looks like your version of Claude Code (X.X.X) needs an update. A newer version (X.X.X or higher) is required to continue."*

Documented in [anthropics/claude-code#2548](https://github.com/anthropics/claude-code/issues/2548) (v1.0.22 blocked in favor of 1.0.24+). The minimum floor moves over time without published schedule — v2.1.98 works as of 2026-04-13 but could be blocked at any point.

### Auto-updates

The native binary installer auto-updates in the background and does not retain old versions. v2.1.98 was already gone from `~/.local/share/claude/versions/` after v2.1.104 installed. `npx @anthropic-ai/claude-code@2.1.98` still works because npm retains all published versions.

### npm deprecation

Anthropic is pushing the native binary installer, which does not support version pinning or downgrading ([anthropics/claude-code#20058](https://github.com/anthropics/claude-code/issues/20058)). Once npm is fully deprecated, the npx downgrade path may stop working.

---

## Additional findings from the issue

- 56 `count_tokens` burst calls observed after first interactive prompt — inflates the apparent "first visible" context number in the statusline
- After `/login` account switch, statusline can jump +/-20K — this is cache invalidation (new `account_uuid` = new cache key), not a billing difference between accounts
- v2.1.104 was untested at time of issue filing
- Reddit investigation with full proxy data: https://www.reddit.com/r/ClaudeCode/comments/1sj10ou/
- Related: [#45515](https://github.com/anthropics/claude-code/issues/45515) (phantom report, now understood as cache invalidation artifact)
- Independent analysis: [claude-code-hidden-problem-analysis](https://github.com/ArkNill/claude-code-hidden-problem-analysis) — 10-20x inflation on Max plans

---

## References

- [anthropics/claude-code#46917](https://github.com/anthropics/claude-code/issues/46917) — Primary issue
- [anthropics/claude-code#45515](https://github.com/anthropics/claude-code/issues/45515) — Phantom report
- [anthropics/claude-code#2548](https://github.com/anthropics/claude-code/issues/2548) — Minimum version enforcement
- [anthropics/claude-code#20058](https://github.com/anthropics/claude-code/issues/20058) — npm deprecation concerns
- [claude-code-hidden-problem-analysis](https://github.com/ArkNill/claude-code-hidden-problem-analysis) — Independent cache bug analysis
- [claude-performance-troubleshooting.md](../../claude-performance-troubleshooting.md) — Parent troubleshooting document
