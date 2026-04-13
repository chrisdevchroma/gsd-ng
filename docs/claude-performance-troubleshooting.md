# Claude Performance & Thinking-Depth Troubleshooting

Reference notes for diagnosing and working around degraded Claude Code behavior. All findings traced to **anthropics/claude-code#42796** (Stella Laurenzo / IREE team, analysis spanning Jan 30 – Apr 1, 2026).

**Maintainer note:** This document is a reference, not a roadmap. When Anthropic ships fixes, annotate the affected section with a date and keep the historical context — the workarounds may rot, but the diagnostic techniques stay useful. Monitor the upstream issue and update when behavior changes.

---

## TL;DR: First-line workarounds

If a session feels degraded — Claude is editing without reading, claiming completion prematurely, dismissing failures as "pre-existing", or ignoring CLAUDE.md instructions — try in this order:

1. **Bump effort for the conversation:** `/effort max`
2. **Counteract the strategy directives:** add a CLAUDE.md override (see limitations below) or use [tweakcc](https://github.com/Piebald-AI/tweakcc) to remove the Output efficiency section from the system prompt entirely
3. **Check the canaries:** see the Canaries section below — compute Read:Edit ratio from your session logs
4. **Isolate the customization layer:** relaunch with `CLAUDE_CODE_SIMPLE=1 claude` and retry — if behavior improves, the issue is in your customizations (hooks, CLAUDE.md, MCPs), not Claude core
5. **Report with transcripts:** run `/bug` and capture the feedback ID for Anthropic support
6. **Try fixed thinking budgets:** set `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` in `~/.claude/settings.json` `env` block and relaunch

### Recommended settings.json

```json
{
  "effortLevel": "high",
  "showThinkingSummaries": true,
  "env": {
    "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING": "1"
  }
}
```

### CLAUDE.md override (partial mitigation only)

Add to your project or user-level CLAUDE.md to counteract the Output efficiency strategy directives (present in v2.1.64–v2.1.99):

```markdown
When facing complex tasks: read all relevant files before editing, consider edge
cases, validate the design before coding. Do not default to the simplest approach —
default to the correct approach, even when it takes longer. If unsure, investigate
rather than guess.
```

**Limitation: this is a band-aid, not a fix.** The CLAUDE.md override directly contradicts the system prompt's Output efficiency section, and contradictory instructions produce non-deterministic behavior. From live introspection during a v2.1.92 session (2026-04-13):

- The system prompt marks its directives as `IMPORTANT` — a strong priority signal that competes with CLAUDE.md's `"These instructions OVERRIDE any default behavior"` preamble. These are two competing authority claims in the same context.
- The system prompt's strategy directives ("try the simplest approach first", "do not overdo it") are **unscoped** — they apply to everything. The CLAUDE.md override scopes itself to "complex tasks," which the model can rationalize as not applying to the current task.
- When both are in context, the model may follow either instruction depending on context window state, attention patterns, and task framing. You cannot reliably predict which wins on any given turn.
- On simple tasks both instructions agree (just do it), so the conflict is invisible. On complex tasks — where it matters most — you're relying on the model to resolve a direct contradiction, and the system prompt has structural advantage (loaded first, marked IMPORTANT).

The CLAUDE.md override shifts the probability toward thorough behavior, but it does not eliminate the competing instruction. For a reliable fix, see the [tweakcc section](#tweakcc-system-prompt-patching) below.

Each of these is explained in detail below.

---

## Background: What happened in Feb–Mar 2026

The #42796 investigation documented a measurable regression in Claude Opus 4.6 reasoning depth starting February 2026, correlating with three changes at Anthropic that landed in the same window:

| Date | Change | Effect |
|------|--------|--------|
| 2026-02-09 | Opus 4.6 launch → adaptive thinking default | Model decides per-turn how deep to think instead of fixed budgets |
| 2026-02-12 | `redact-thinking-2026-02-12` beta header rolled out | Thinking summaries hidden from client (UI only) |
| 2026-03-03 | Medium effort (`effort=85`) became default on Opus 4.6 | Latency/cost sweet spot, reduced thinking budget for most users |
| 2026-03-03 | Output efficiency section added to system prompt (v2.1.64) | Includes strategy directives: "try the simplest approach first", "do not overdo it" ([full timeline](research/claude-code-internals/output-efficiency-timeline.md)) |
| 2026-03-08 | Redacted thinking crossed 50% of responses | Quality regression independently reported this day |
| 2026-03-12 | 100% redacted thinking | All thinking now hidden by default |

**Note:** The medium effort default and the Output efficiency prompt landed on the same day (Mar 3), making their individual contributions to the regression inseparable without controlled testing. [Source analysis of v2.1.63](research/claude-code-internals/versions/v2.1.63-thinking-config-analysis.md) confirms that adaptive thinking was already being sent to the API before either of these changes.

Per Ben Cherny (Anthropic) in comments on the issue: the redaction is **UI-only** — it doesn't reduce thinking itself, only hides summaries from the client. The *actual* reasoning-depth change came from the adaptive thinking default + the `effort=85` default. Raising `/effort` to `high` or `max` restores the thinking budget; disabling adaptive thinking reverts to fixed budgets (which may be better or worse depending on whether the adaptive mode has a bug on your workload — curtiscook suggested in #42796 that it decides some issues are "probably small" and under-thinks).

### The numbers (from benvanik's analysis, 6,852 sessions across 4 IREE projects)

| Metric | Good (Jan 30 – Feb 12) | Degraded (Mar 8 – Mar 23) | Change |
|--------|------------------------|----------------------------|--------|
| Read:Edit ratio | 6.6 | 2.0 | −70% |
| Stop-hook violations | 0 | 173 (avg 10/day, peak 43/day) | ∞ |
| Edits without prior read | 6.2% | 33.7% | +5.4× |
| Reasoning loops per 1K tool calls | 8.2 | 21.0 | +2.6× |
| "Simplest" claims per 1K tool calls | 2.7 | 6.3 | +2.3× |
| User interrupts per 1K tool calls | 0.9 | 11.4 | +12× |
| Frustration indicators in prompts | baseline | +68% | +68% |

### Thinking depth estimate (from `signature` field correlation)

The `signature` field on thinking blocks has **0.971 Pearson correlation** with thinking content length (7,146 paired samples in benvanik's dataset). This means thinking depth can be estimated from session JSONL logs even when thinking content itself is redacted.

| Period | Est. median thinking | vs baseline |
|--------|---------------------|-------------|
| Jan 30 – Feb 8 | ~2,200 chars | — |
| Late February | ~720 chars | −67% |
| March 1–5 | ~560 chars | −75% |
| March 12+ (fully redacted) | ~600 chars | −73% |

Interpret cautiously — this is a correlation on one user's data, not a formal measurement. But it's a useful shape of evidence.

### Time-of-day pattern

benvanik's analysis found **5pm PST (17:00 America/Los_Angeles) was the worst hour** for thinking depth — median 423 chars vs baseline, substantially lower than off-peak hours. Hypothesis: Anthropic may load-shed thinking budget during peak traffic.

**Practical implication:** if you hit weird model behavior during what would be US West Coast peak hours, consider retrying off-peak before assuming the issue is your prompt or project. Peak hours correspond roughly to:

| Your timezone | Peak (worst-hour) window |
|---------------|--------------------------|
| America/Los_Angeles (PST/PDT) | 16:00 – 18:00 |
| America/New_York (EST/EDT) | 19:00 – 21:00 |
| Europe/London (GMT/BST) | 00:00 – 02:00 (next day) |
| Europe/Amsterdam (CET/CEST) | 01:00 – 03:00 (next day) |
| Asia/Tokyo (JST) | 09:00 – 11:00 (next day) |

This is **one data point from one user's analysis** — not a confirmed Anthropic pattern. Treat as a hypothesis to test, not a rule. If you can reproduce a degradation off-peak, it's not load-shedding.

---

## Configuration reference

All paths assume `~/.claude/settings.json` (user global). Project-scoped overrides go in `.claude/settings.json` or `.claude/settings.local.json`. Precedence (highest wins): managed → local → project → user.

### `showThinkingSummaries: true`

**Type:** settings.json key (boolean)
**Default:** Effectively `false` in interactive mode (thinking shown as collapsed stub)
**Effect:** Restores visible thinking summaries in interactive Claude Code sessions. Does NOT change how much the model thinks — it only changes whether you can see the summary. Redaction is UI-only per bcherny.

```json
{
  "showThinkingSummaries": true
}
```

Docs: https://code.claude.com/docs/en/settings

### `effortLevel`

**Type:** settings.json key (string: `"low" | "medium" | "high"`)
**Default:** `"medium"` (set 2026-03-03 for Opus 4.6)
**Also set via:** `/effort low|medium|high` slash command (sticky, writes to settings.json)
**Effect:** Persistent thinking-effort setting across sessions.

```json
{
  "effortLevel": "high"
}
```

For long autonomous workflows, `"high"` is the recommended default — reasoning quality matters more than per-turn latency.

### `/effort max` (conversation-level)

**Type:** Slash command, not persisted
**Default:** Not applied unless invoked
**Effect:** Raises effort above `high` for the rest of the current conversation. Does NOT write to settings.json (intentional — it's a conversation escalation, not a persistent default).

Use when a particular phase is genuinely gnarly and `effortLevel: "high"` feels insufficient. Expect higher token usage and latency.

### `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`

**Type:** Environment variable
**Available since:** At least v2.1.63 (Feb 28, 2026) — confirmed via [source code analysis](research/claude-code-internals/versions/v2.1.63-thinking-config-analysis.md). The env var check exists in the minified bundle and is functional. The exact introduction version is unknown but predates v2.1.63.
**Default:** Unset (adaptive thinking enabled since Opus 4.6 launch, 2026-02-09)
**Effect:** Opts out of Opus 4.6's adaptive thinking mode, reverting to fixed thinking budgets. Independent of `effortLevel` — raising effort does not prevent adaptive from dropping below its budget on a per-turn basis.

**Important:** There is no version of Claude Code post-Opus-4.6 that avoids adaptive thinking without this env var. [Source analysis of v2.1.63](research/claude-code-internals/versions/v2.1.63-thinking-config-analysis.md) proves that even the oldest post-Opus-4.6 versions send `thinking: { type: "adaptive" }` by default. Downgrading does not escape adaptive thinking.

Three ways to set it:

```json
// ~/.claude/settings.json (recommended — scoped to Claude Code)
{
  "env": {
    "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING": "1"
  }
}
```

```bash
# ~/.bashrc (persistent, affects all shell children)
export CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1
```

```bash
# Per-invocation (one-off test)
CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1 claude
```

**How it works internally (from v2.1.63 source analysis):**

```javascript
// Deobfuscated from cli.js — the thinking config decision point
if (!isTruthy(process.env.CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING)
    && supportsAdaptive(model)
    && effortBudget === null) {
    thinkingConfig = { type: "adaptive" };       // default path
} else {
    let budget = effortBudget ?? getDefaultBudget(model);
    thinkingConfig = { type: "enabled", budget_tokens: budget };  // fixed path
}
```

When set to `1`, the condition short-circuits and the code falls through to the `else` branch, sending `{ type: "enabled", budget_tokens: N }` with a fixed budget. See [research/claude-code-internals/versions/v2.1.63-thinking-config-analysis.md](research/claude-code-internals/versions/v2.1.63-thinking-config-analysis.md) for the full decision tree and deobfuscation.

**Caveat:** If Anthropic fixes the adaptive thinking bug (curtiscook's hypothesis), fixed budgets may become *worse* than tuned adaptive. Revisit this setting if you see Anthropic acknowledge an adaptive-thinking bugfix in changelogs.

### `CLAUDE_CODE_AUTO_COMPACT_WINDOW`

**Type:** Environment variable
**Default:** Unset (uses 1M context when available)
**Effect:** Forces a smaller effective context window for auto-compact decisions. bcherny suggested `400000` (400K tokens) as a diagnostic when 1M context feels degraded.

```bash
# ~/.bashrc
export CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000
```

Or via settings.json `env` block (same pattern as above).

**When to try:** if behavior degrades after ~200K tokens of conversation (hypothesis from #42796 commenter: model may handle 200K better than 1M on complex reasoning). This is unconfirmed — try as a diagnostic, not a permanent setting.

### `CLAUDE_CODE_SIMPLE=1`

**Type:** Environment variable
**Default:** Unset
**Effect:** Disables ALL customizations — MCPs, CLAUDE.md loading, hooks, user skills, project overrides. Gives you a clean Claude Code baseline with no augmentation.

```bash
CLAUDE_CODE_SIMPLE=1 claude
```

**Primary use case:** isolation debugging. When Claude is misbehaving in a customized session, relaunching with `CLAUDE_CODE_SIMPLE=1` tells you whether the issue is in:

- **Claude Code core** (still broken in SIMPLE mode) → report to Anthropic via `/bug`
- **Your customization layer** (fixed in SIMPLE mode) → debug your hooks, MCPs, or user-level CLAUDE.md
- **Your project** (fixed in SIMPLE mode, also fixed when you remove project CLAUDE.md) → debug your project config

Do NOT use as a permanent setting — it disables all customization, including useful tooling.

### `/bug` feedback ID

**Type:** Slash command
**Effect:** Generates a feedback ID Anthropic support can use to pull transcripts and debug specific sessions.

Per bcherny on #42796: *"what would make the reports most actionable for our team are transcripts. You can generate these with `/bug` and paste the feedback ids here, or share via your AE."*

Practical advice: if you hit weird behavior, run `/bug` before closing the session. Capture the feedback ID alongside notes about what you were doing. Without a feedback ID, Anthropic support can only give generic advice — with one, they can see exactly what happened.

### `env` block in settings.json (general mechanism)

Claude Code's `settings.json` supports an `env` field that injects environment variables into every Claude Code session. Useful for scoping env vars to Claude Code without polluting the shell:

```json
{
  "env": {
    "CLAUDE_CODE_ENABLE_TELEMETRY": "1",
    "OTEL_METRICS_EXPORTER": "otlp",
    "CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING": "1"
  }
}
```

Values must be strings (`"1"`, not `1`). Takes effect on next `claude` launch.

---

## Canaries (leading indicators of degradation)

These are *leading* indicators — they go off before a phase visibly fails. Use them to catch drift early and escalate (bump effort, relaunch, report).

### Read:Edit ratio

Count of Read tool calls vs Edit/Write tool calls in a session. benvanik's measured thresholds:

| Ratio | Status | Interpretation |
|-------|--------|----------------|
| > 5.0 | healthy | Normal read-heavy behavior |
| 3.0–5.0 | yellow | Watch for continued decline |
| < 3.0 | red | Degraded — Claude is editing without reading |
| < 2.0 | critical | Matches benvanik's degraded-period baseline |

**Source data:** `~/.claude/projects/<project-slug>/<session-id>.jsonl` (session log files Claude Code writes automatically — no configuration needed).

**How to compute manually:** parse the JSONL, count `tool_use` entries where `name == "Read"` vs `name in ["Edit", "Write", "MultiEdit"]`. Exclude Bash, Grep, Glob, MCP tools — the metric is specifically "does Claude look at code before modifying it".

### Stop-hook violation rate

Count of times Claude's last message triggers a phrase in the stop-phrase-guard hook — e.g., "pre-existing", "good stopping point", "should I continue?". Measured thresholds from benvanik:

| Violations/day | Status |
|----------------|--------|
| 0–1 | healthy |
| 2–5 | yellow |
| 6–15 | red (matches degraded-period avg of 10/day) |
| > 15 | critical (matches peak drift of 43/day) |

**Prerequisite:** a Stop hook that logs violations. benvanik's bash reference implementation is at https://gist.github.com/benvanik/ee00bd1b6c9154d6545c63e06a317080 — it blocks on violation but doesn't persist a log by default; add file logging if you want rate analysis over time.

**Violation categories** (from benvanik's analysis, with distribution across Mar 8–25):

| Category | Count | Examples |
|----------|-------|----------|
| Ownership dodging | 73 | "not caused by my changes", "existing issue", "pre-existing" |
| Permission-seeking | 40 | "should I continue?", "want me to keep going?" |
| Premature stopping | 18 | "good stopping point", "natural checkpoint" |
| Known-limitation labeling | 14 | "known limitation", "future work" |
| Session-length excuses | 4 | "continue in a new session", "getting long" |

---

## Diagnostic recipes

### Recipe 1: "A task that used to work is now failing"

1. Check the canaries — compute Read:Edit ratio from session JSONL and check stop-hook violation count if you log them
2. If canaries are red: bump `/effort max`, retry the task
3. If still failing: `CLAUDE_CODE_SIMPLE=1 claude` → retry without any customizations
4. If SIMPLE also fails: the issue is in Claude Code or Anthropic's backend
   - Run `/bug` to capture a feedback ID
   - Check #42796 and related issues for current regressions
   - Note the time of day — if peak-hours, retry off-peak as a test
5. If SIMPLE fixes it: the issue is in your customization layer
   - Bisect: try with only CLAUDE.md (no hooks or MCPs)
   - Then with hooks but no CLAUDE.md (rename project CLAUDE.md temporarily)
   - Report findings against the specific customization that caused it

### Recipe 2: "Claude is claiming completion but the task isn't done"

This is the "NOTHING IS PRE-EXISTING" / "NO KNOWN LIMITATIONS" drift pattern.

1. If you log stop-hook violations, check the rate — confirms drift pattern
2. Immediate fix: call it out in conversation with the rule text ("You own every change. The tests are failing. Investigate and fix them.")
3. Session-level fix: `/effort max` to bump thinking
4. Persistent fix: install benvanik's stop-phrase-guard hook (https://gist.github.com/benvanik/ee00bd1b6c9154d6545c63e06a317080)
5. If the pattern recurs across sessions, it's not a one-off — report with `/bug`

### Recipe 3: "Claude is editing without reading context"

This is the Read:Edit ratio drift pattern.

1. Parse session JSONL and confirm the Read:Edit ratio is below 3.0
2. Immediate fix: explicitly tell Claude "read the relevant files before editing"
3. Session-level fix: `/effort max`
4. If persistent: try `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` in settings.json env block and relaunch — adaptive thinking may be under-budgeting reads
5. Isolation test: `CLAUDE_CODE_SIMPLE=1 claude` with the same prompt — if the behavior changes in SIMPLE mode, something in your customization is suppressing the read behavior

### Recipe 4: "Behavior varies by time of day"

Hypothesis-testing only — this pattern is not confirmed.

1. Note the exact time (with timezone) when behavior is bad
2. Compute peak-hours offset for your timezone (see Time-of-day table above)
3. Retry the same workflow off-peak, same prompt
4. If behavior consistently improves off-peak across multiple tests, capture `/bug` feedback IDs for both and report the time-of-day correlation to Anthropic

---

## Issue #42796 full findings (reference)

For archival purposes. If the issue is ever deleted or edited, this section preserves the key data.

**Issue:** https://github.com/anthropics/claude-code/issues/42796
**Author:** stellaraccident (Stella Laurenzo, IREE team)
**Anthropic respondent:** bcherny (Ben Cherny)
**Stop-hook gist (upstream):** https://gist.github.com/benvanik/ee00bd1b6c9154d6545c63e06a317080
**Stop-hook gist (safekeeping fork):** https://gist.github.com/chrisdevchroma/fc2d355bbe87eb3f9f1b00d830e71747

### Scope of the analysis

- 6,852 Claude Code session JSONL files
- 4 projects: iree-loom, iree-amdgpu, iree-remoting, bureau
- 17,871 thinking blocks (7,146 with content, 10,725 redacted)
- 234,760 tool calls
- 18,000+ user prompts
- Date range: Jan 30 – Apr 1, 2026

### Symptoms reported

1. Claude ignores instructions
2. Claims "simplest fixes" that are incorrect
3. Does opposite of requested activities
4. Claims completion against instructions
5. Edits without reading context
6. Premature stopping and permission-seeking

### Timeline of thinking redaction rollout

| Date | Thinking visible | Thinking redacted |
|------|------------------|-------------------|
| Jan 30 – Mar 4 | 100% | 0% |
| Mar 5 | 98.5% | 1.5% |
| Mar 7 | 75.3% | 24.7% |
| Mar 8 | 41.6% | 58.4% ← quality regression reported independently this day |
| Mar 10–11 | <1% | >99% |
| Mar 12+ | 0% | 100% |

### Reported solutions from bcherny (Anthropic)

Verbatim-derivable from his three comments (2026-04-06):

1. **Thinking summaries are UI-only.** The `redact-thinking-2026-02-12` beta header hides summaries from the client to reduce latency. It does not impact thinking itself, budgets, or how extended reasoning works under the hood. Opt out with `showThinkingSummaries: true`.

2. **Two changes in Feb impacted thinking:**
   - **Opus 4.6 launch (Feb 9)** → adaptive thinking default (model decides how long to think). Opt out with `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`.
   - **Medium effort default on Opus 4.6 (Mar 3)** → `effort=85` rolled out as a latency/cost sweet spot. Raise with `/effort high` or `/effort max`, or set `effortLevel` in settings.json.

3. **Troubleshooting recipe:**
   - `/effort high` or `/effort max` to increase maximum thinking tokens per problem
   - `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` to force a shorter context window
   - `CLAUDE_CODE_SIMPLE=1` to disable all MCPs, CLAUDE.md, hooks, and customizations as a baseline test
   - `/bug` to generate transcripts and share feedback IDs for actionable support

4. **ULTRATHINK keyword** — single-turn high-effort escalation, typed in the user message.

5. **Going forward:** Anthropic planned to test defaulting Teams and Enterprise users to `effort=high` to benefit from extended thinking at the cost of tokens and latency. Configurable via `/effort` and settings.json.

6. **1M context is dogfooded internally.** bcherny stated Anthropic uses 1M exclusively and evals look good, but suggested trying `CLAUDE_CODE_AUTO_COMPACT_WINDOW=400000` as a diagnostic if 1M feels degraded.

### Behavioral metric deltas (good vs degraded)

| Metric | Good | Degraded | Change |
|--------|------|----------|--------|
| Edits without prior read | 6.2% | 33.7% | +5.4× |
| Reasoning loops per 1K calls | 8.2 | 21.0 | +2.6× |
| "Simplest" per 1K calls | 2.7 | 6.3 | +2.3× |
| User interrupts per 1K calls | 0.9 | 11.4 | +12× |
| Read:Edit ratio | 6.6 | 2.0 | −70% |
| Stop hook violations (17 days) | 0 | 173 | — |

### Stop-hook violation categories (Mar 8–25)

| Category | Count | Examples |
|----------|-------|----------|
| Ownership dodging | 73 | "not caused by my changes", "existing issue" |
| Permission-seeking | 40 | "should I continue?", "want me to keep going?" |
| Premature stopping | 18 | "good stopping point", "natural checkpoint" |
| Known-limitation labeling | 14 | "known limitation", "future work" |
| Session-length excuses | 4 | "continue in a new session", "getting long" |

Peak day: March 18, 43 violations (~1 every 20 minutes of active use).

### What Anthropic was asked for (from the issue)

1. **Transparency about thinking allocation** — if thinking tokens are reduced or capped, users need visibility
2. **"Max thinking" tier** — users doing complex engineering would pay more for guaranteed deep thinking
3. **Thinking token metrics in API responses** — expose `thinking_tokens` in usage response (even if content is redacted) so users can monitor reasoning depth
4. **Canary metrics from power users** — aggregate stop-hook violation rates and similar leading indicators across the user base to detect quality regressions community-wide

---

---

## Issue #46917: Server-side token inflation in v2.1.100+

Separate from the thinking-depth regression above, **anthropics/claude-code#46917** documents a distinct problem: Claude Code v2.1.100+ silently adds ~20,000 extra `cache_creation_input_tokens` per request compared to v2.1.98, despite sending fewer bytes in the client payload. The inflation is entirely server-side.

**Issue:** https://github.com/anthropics/claude-code/issues/46917
**Status:** Open (as of 2026-04-13), assigned to @notitatall, 83 upvotes
**Labels:** area:cost, bug, has repro

### Evidence

Measured via HTTP proxy (`claude-code-logger`) capturing full request/response bodies. Each test is a cold cache, single API call, no session state (`--print` mode), same machine, same account, minutes apart.

| Version | Content-Length (bytes) | cache_creation_input_tokens | cache_read | Total |
|---------|----------------------|----------------------------|------------|-------|
| v2.1.98 | 169,514 | **49,726** | 0 | 49,726 |
| v2.1.100 | 168,536 (−978 B) | **69,922** | 0 | 69,922 |
| v2.1.101 | 171,903 (+2,389 B) | ~72,000 | 0 | ~72,000 |

v2.1.100 sends 978 fewer bytes but is billed **20,196 more tokens**. Cross-account test (two Max accounts, same v2.1.98) showed < 500 token delta — not account-specific.

Interactive mode analysis across 40+ sessions shows a bimodal distribution: ~50K (v2.1.98 baseline) vs ~71K (v2.1.100+). Some sessions start cold at 71K with `cache_read=0`, confirming this is the baseline, not accumulated cache.

### Impact

- **~40% token overhead** on a clean project — Max plan users hit 5-hour cap significantly faster
- These are `cache_creation_input_tokens` — they enter the model's context window, not just the billing ledger
- **Instruction dilution:** hidden server-injected content may compete with user-provided CLAUDE.md rules
- **Reduced effective context:** 20K fewer tokens for conversation history (compounds per turn in long sessions)
- **Unverifiable behavior:** users cannot audit what the model "sees" vs what they sent

### Reproduction

```bash
# 1. Install proxy to capture full API request/response bodies
mkdir /tmp/cc-test && cd /tmp/cc-test
npx -y claude-code-logger@1.0.2 start --port 8000 --log-body --merge-sse

# 2. In another terminal — test with older version
export ANTHROPIC_BASE_URL="http://localhost:8000"
claude-2.1.98 --print "1+1"
# Note cache_creation_input_tokens in response

# 3. Same setup — test with newer version
claude-2.1.100 --print "1+1"
# Note cache_creation_input_tokens in response
```

### Workaround: downgrade to v2.1.98

```bash
# Check available local versions
ls ~/.local/share/claude/versions/

# Use v2.1.98 via npx
npx claude-code@2.1.98 --print "1+1"
```

**Caveats:**

- **Auto-updates fight you.** The native binary installer auto-updates in the background and does not retain old versions — v2.1.98 was already gone from `~/.local/share/claude/versions/` after v2.1.104 installed. `npx claude-code@2.1.98` still works because npm retains all published versions.
- **Server-side minimum version enforcement.** Claude Code checks a server-side minimum version on launch. If your version falls below the floor, it refuses to start: *"It looks like your version of Claude Code (X.X.X) needs an update. A newer version (X.X.X or higher) is required to continue."* ([anthropics/claude-code#2548](https://github.com/anthropics/claude-code/issues/2548) documents an early example where v1.0.22 was blocked in favor of 1.0.24+.) The minimum floor moves over time without published schedule — v2.1.98 works as of 2026-04-13 but could be blocked at any point.
- **npm install is being deprecated.** Anthropic is pushing the native binary installer, which does not support version pinning or downgrading ([anthropics/claude-code#20058](https://github.com/anthropics/claude-code/issues/20058)). Once npm is fully deprecated, the `npx` downgrade path may stop working.

**Bottom line:** Downgrading is a temporary workaround, not a permanent solution — it's a race against the minimum version floor.

### Speculative workaround: User-Agent header override

Suggested by @fabifont in the issue comments — the hypothesis is that Anthropic routes requests server-side based on the `User-Agent` header (which embeds the CC version string), so spoofing it to the v2.1.98 value would avoid the extra token injection:

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

**Plausibility assessment (unconfirmed — test before relying on this):**

Arguments *for*:
- The issue author attributes the inflation to "likely User-Agent routing" — the only variable between test runs was the CC version, and the client payload was actually smaller in v2.1.100
- `ANTHROPIC_CUSTOM_HEADERS` is a documented Claude Code env var that injects headers into API requests
- Server-side A/B routing by client version string is a standard practice

Arguments *against*:
- Nobody in the issue thread confirmed actually testing the override and measuring the result
- Separate research (https://gist.github.com/mrcattusdev/53b046e56b5a0149bdb3c0f34b5f217a) suggests Anthropic fingerprints clients via the **system prompt content**, not HTTP headers — if the server-side injection is triggered by prompt matching rather than User-Agent parsing, a header override alone would have no effect
- The SDK may set or override User-Agent internally after `ANTHROPIC_CUSTOM_HEADERS` is applied — the override may not actually reach Anthropic's servers
- Spoofing version strings may have unintended side effects if the server uses User-Agent for feature gating beyond token injection

**Verdict:** worth a quick test (measure `cache_creation_input_tokens` with and without the override using the proxy reproduction above), but do not assume it works without verifying. The downgrade workaround is the confirmed fix.

### Additional notes

- 56 `count_tokens` burst calls observed after first interactive prompt — inflates the apparent "first visible" context number in the statusline
- After `/login` account switch, statusline can jump ±20K — this is cache invalidation (new `account_uuid` = new cache key), not a billing difference between accounts
- v2.1.104 was untested at time of issue filing — unknown whether it carries the same inflation
- Reddit investigation with full proxy data: https://www.reddit.com/r/ClaudeCode/comments/1sj10ou/
- Related: #45515 (phantom token report, now understood as cache invalidation artifact)

---

## Fact-check: "Output efficiency prompt causes lobotomized behavior"

A claim circulating on social media (notably via [Grok on X](https://x.com/grok/status/2043556654013157504)) and in [anthropics/claude-code#45704](https://github.com/anthropics/claude-code/issues/45704) attributes the Claude Code quality regression primarily to the "Output efficiency" section of the system prompt — the instructions that read:

> *"IMPORTANT: Go straight to the point. Try the simplest approach first without going in circles. Do not overdo it. Be extra concise."*

The claim further asserts that Anthropic uses a different, superior internal prompt ("think step by step, err on the side of more explanation, act as a collaborator") and that the March 31 source code leak "confirmed" this divergence.

### What's true

1. **The Output efficiency section exists and has a turbulent history.** It is present in v2.1.92 (confirmed from a live session dump — see [v2.1.92-system-prompt.md](research/claude-code-internals/versions/v2.1.92-system-prompt.md)). Per [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) release tracking, the section has been added and removed multiple times:

   | Version | Date | Status | Source |
   |---------|------|--------|--------|
   | v2.1.63 and earlier | before Mar 3 | **Not present** | — |
   | v2.1.64 | 2026-03-03 | Added | [v2.1.64 release](https://github.com/Piebald-AI/claude-code-system-prompts/releases/tag/v2.1.64) |
   | v2.1.66 | 2026-03-04 | Removed | [v2.1.66 release](https://github.com/Piebald-AI/claude-code-system-prompts/releases/tag/v2.1.66) |
   | v2.1.69 | 2026-03-05 | Re-added | [v2.1.69 release](https://github.com/Piebald-AI/claude-code-system-prompts/releases/tag/v2.1.69) |
   | v2.1.92 | — | Present | Live session dump (this doc) |
   | v2.1.100 | 2026-04-10 | Removed | [v2.1.100 release](https://github.com/Piebald-AI/claude-code-system-prompts/releases/tag/v2.1.100) |

   **Notably, v2.1.64 (Mar 3) is the same day the medium effort default (`effort=85`) shipped** — both the Output efficiency prompt and the reduced effort level landed together, which explains why the quality regression was independently reported starting that exact date in the #42796 investigation. The two changes are confounded in user experience, making it difficult to attribute the regression to one or the other without controlled testing.

   The oldest version that never contained the Output efficiency section is **v2.1.63**. Versions **v2.1.66–v2.1.68** are a brief gap where it was temporarily removed before being re-added in v2.1.69.

2. **The March 31 leak revealed the system prompt.** The `.npmignore` packaging error exposed Claude Code's source, including the full system prompt text. This is well-documented.

3. **The model weights did not change.** Opus 4.6 weights stayed the same — the regression is harness-level, not model-level. This is consistent with the #42796 findings.

4. **The quality regression is real and widely reported.** Thousands of users experienced shallower, less thorough behavior starting in February–March 2026.

5. **CLAUDE.md overrides and `/effort max` help.** These are confirmed workarounds — bcherny recommended `/effort max` and `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` in #42796.

### What's misleading or unverified

1. **"Keep simplistic" is a fabricated quote.** The actual text says "Try the simplest approach first" — there is no "Keep simplistic" anywhere in the system prompt. This is Grok paraphrasing in an inflammatory way.

2. **The causal attribution is incomplete, not wrong.** The #42796 investigation (6,852 sessions, 234,760 tool calls) and bcherny's official Anthropic response attribute the quality regression to two specific changes:
   - **Adaptive thinking default** (Feb 9, 2026) — model decides per-turn how deeply to think, sometimes under-budgeting
   - **Medium effort default** (Mar 3, 2026) — `effort=85` reduced thinking budgets for most users

   However, the Output efficiency section is not innocent either. It contains **two distinct types of instruction** that should not be conflated:
   - **Text formatting directives** ("Be extra concise", "If you can say it in one sentence, don't use three", "Lead with the answer or action, not the reasoning") — these affect verbosity and are scoped by the carve-out "This does not apply to code or tool calls."
   - **Problem-solving strategy directives** ("Try the simplest approach first", "Do not overdo it", "Go straight to the point") — these affect *how the model approaches tasks*, not just how it formats responses. Telling a model to "try the simplest approach first" when it faces a complex architecture decision actively steers it away from thorough investigation — reading all relevant files, considering edge cases, validating the design before coding.

   The Grok claim that the Output efficiency prompt is *the* cause is still overstated — adaptive thinking + medium effort defaults are the primary documented factors, and the Output efficiency section landed on the same day (v2.1.64, Mar 3), making the three changes fully confounded in user experience. But dismissing the strategy directives as "just verbosity" is wrong. They plausibly contribute to the observed degradation, even if isolating their individual impact requires controlled testing that nobody has published.

3. **The "internal vs external prompt" claim is unverified.** The assertion that Anthropic employees use a different, superior prompt ("think step by step, err on the side of more explanation") has no verified source. The [BSWEN article](https://docs.bswen.com/blog/2026-04-01-why-claude-code-acts-dumb-system-prompt/) making this claim provides no evidence — no leaked documents, no screenshots, no citations. The March 31 leak revealed one prompt, not a comparison of two.

4. **The Output efficiency section is a mix of formatting and strategy.** Some instructions target text output formatting ("Lead with the answer or action, not the reasoning", "Skip filler words, preamble, and unnecessary transitions") and are scoped by the carve-out "This does not apply to code or tool calls." But "Try the simplest approach first" and "Do not overdo it" are unscoped strategy directives that influence how the model plans and executes tasks — not just how it communicates results. See point 2 above for the full breakdown.

5. **#45704 was closed as a duplicate of #42796.** The GitHub issue making this system-prompt-as-root-cause argument was triaged as a duplicate of the adaptive-thinking/effort-level issue — Anthropic did not validate the system prompt attribution.

### The user-patched prompt from #45704

The #45704 author claimed that patching the system prompt (replacing Output efficiency with collaborative instructions) at medium effort outperformed unpatched at high effort. This is a single user's report with no controlled methodology — it conflates multiple variables (prompt text, effort level, session state, time of day) and does not isolate the Output efficiency section as the causal factor. The author also pinned to v2.1.87, which predates the medium-effort default (v2.1.89+), introducing another confound.

For reference, the user's replacement prompt text:

> *"When sending user-facing text, you're writing for a collaborator, not logging to a console. Assume the user can't see most tool calls or thinking — only your text output. Before your first tool call, briefly state what you're about to do and why. Err on the side of more explanation when the task involves architecture, debugging, or non-obvious trade-offs. Think through the problem step by step. You're a collaborator, not just an executor. When you spot a flaw in the approach — yours or the user's — flag it before proceeding. Be precise, not brief. Never take the simplest approach when it is not the correct one. The correct implementation is the only acceptable one, even when it takes longer. If unsure, ask — don't guess."*

This is a reasonable CLAUDE.md override — and it works on two levels: it changes communication style (more explanation, collaborative tone), but it also directly counteracts the strategy directives by replacing "try the simplest approach" with "never take the simplest approach when it is not the correct one." Whether the improvement the author observed came from the strategy override, the effort level, or both is unknown without controlled testing. For maximum effect, combine a CLAUDE.md strategy override with `/effort high` or `/effort max` + `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1`.

### Verdict

The Grok statement takes two real things — (1) the Output efficiency prompt exists, and (2) Claude Code quality regressed — and overstates the causal relationship. The primary documented root cause (#42796, confirmed by Anthropic) is adaptive thinking defaults + reduced effort levels. However, the Output efficiency section's strategy directives ("try the simplest approach first", "do not overdo it") plausibly contribute to degraded behavior on complex tasks by steering the model toward shallow solutions. All three changes (adaptive thinking, medium effort, output efficiency prompt) landed in the same window and are confounded — attributing the regression to any single one is unsupported. The "internal vs external prompt" claim remains unverified speculation.

---

## tweakcc: system prompt patching

[tweakcc](https://github.com/Piebald-AI/tweakcc) (1.7k+ stars, by the Piebald-AI team) is a CLI tool that patches Claude Code's system prompts, UI, and behavior by modifying the minified `cli.js` bundle. Unlike CLAUDE.md overrides, which compete with the system prompt, tweakcc **removes or replaces the offending instructions directly** — the model never sees them.

### How it works

tweakcc reads customizations from `~/.tweakcc/config.json` and applies them to the Claude Code binary:

- **npm installs:** modifies `cli.js` directly
- **Native binary installs:** extracts the JavaScript using `node-lief`, applies patches, and repacks the binary
- **Survives updates:** customizations are stored in the config file and can be reapplied via `npx tweakcc --apply` after Claude Code updates

### Relevant capabilities

For the Output efficiency problem specifically:

- **Custom system prompts:** tweakcc can modify any section of Claude Code's system prompt, including removing the Output efficiency section entirely or replacing it with collaborative instructions
- **Ad-hoc patching:** `npx tweakcc adhoc-patch --string` can do targeted string replacements in the bundle (e.g., replacing "Try the simplest approach first" with different instructions)
- **Remote config:** `npx tweakcc --apply --config-url <url>` can apply shared configurations from a Gist, useful for distributing a known-good prompt patch across a team

### Other notable features

Beyond prompt patching, tweakcc offers:

| Feature | Description |
|---------|-------------|
| Custom toolsets | Accessible via `/toolset` command |
| Subagent model config | Choose which model each subagent (Plan, Explore, general-purpose) uses |
| Thinking block expansion | Expand thinking by default without needing Ctrl+O |
| MCP startup optimization | ~50% faster startup via non-blocking connections |
| AGENTS.md support | Create agent specifications |
| Themes, spinners, input styling | Visual customization |
| `unpack` / `repack` commands | Extract and inspect the JavaScript from native binaries |

### Install

```bash
npx tweakcc          # interactive TUI
# or
pnpm dlx tweakcc
```

### Terms of Service status

**Technically prohibited, practically tolerated.** Anthropic's [Commercial Terms of Service](https://www.anthropic.com/legal/commercial-terms) (Section D.4) state:

> *"Customer may not and must not attempt to (a) access the Services to build a competing product or service... **(b) reverse engineer or duplicate the Services**; or (c) support any third party's attempt at any of the conduct restricted in this sentence."*

tweakcc deobfuscates minified JavaScript, modifies it, and repacks binaries — that fits the definition of reverse engineering. Additionally, Section K.3 disclaims Anthropic's indemnification obligations for *"modifications made by Customer to the Services."*

However, the practical reality:

- **Anthropic has taken no action against tweakcc.** The project was [announced on the Claude Code repo](https://github.com/anthropics/claude-code/issues/4429) (issue #4429) in July 2025. The issue was closed as "stale/not planned" in February 2026 — not as a ToS violation. No cease-and-desist, no DMCA takedown.
- **1.7k+ stars, listed on community sites.** tweakcc is referenced on ClaudeLog, Claude Hub, and the "Awesome Claude Code" list. The Piebald-AI team also maintains [claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts), which extracts and publishes system prompts for every version — the same category of reverse engineering, also tolerated.
- **The source code was accidentally published.** The March 31, 2026 npm packaging error exposed 512,000 lines of Claude Code TypeScript source. The code tweakcc patches is no longer a trade secret. This doesn't change the ToS, but it weakens any practical enforcement argument.
- **Claude Code's LICENSE.md contains no license.** It says only: *"© Anthropic PBC. All rights reserved. Use is subject to Anthropic's Commercial Terms of Service."* — deferring entirely to the Commercial ToS linked above.

**Bottom line:** Use at your own risk. The ToS technically prohibits it. Anthropic has shown no interest in enforcing this against tooling that improves the user experience without competing with or reselling the service. This could change at any time.

### Other caveats

- **Patches may break across major Claude Code versions.** System prompt patches (via the config) are more resilient than ad-hoc patches against minified code.
- **Reapply after updates:** run `npx tweakcc --apply` after each Claude Code update.
- **Security:** ad-hoc patch scripts run sandboxed (`--experimental-permission`), but always review diffs before applying. Patches can inject arbitrary code into the executable.

### Why this matters

The Output efficiency strategy directives ("try the simplest approach first", "do not overdo it") cannot be disabled via any Claude Code setting. CLAUDE.md overrides compete with the system prompt and produce non-deterministic behavior (see the [CLAUDE.md limitation analysis](#claudemd-override-partial-mitigation-only) above). tweakcc is currently the only reliable way to remove these directives on versions where they exist (v2.1.64–v2.1.99), short of waiting for Anthropic to ship a toggle or upgrading to v2.1.100+ (which brings the token inflation problem).

---

## Version pinning strategies

If you've identified a version that works well with your settings and patches, you'll want to prevent Claude Code from auto-updating past it. Two approaches:

### Strategy 1: Native binary + disable auto-updater

You're likely already on the native binary (`~/.local/share/claude/versions/<version>`). The auto-updater can be disabled via environment variable or settings.

**Via settings.json `env` block (recommended — scoped to Claude Code):**

```json
// ~/.claude/settings.json
{
  "env": {
    "DISABLE_AUTOUPDATER": "1"
  }
}
```

**Via shell environment:**

```bash
# ~/.bashrc or ~/.zshrc
export DISABLE_AUTOUPDATER=1
```

**How the auto-updater logic works internally (from v2.1.92 source):**

```javascript
function isAutoUpdateDisabled() {
    // 1. Env var — highest priority, always respected
    if (isTruthy(process.env.DISABLE_AUTOUPDATER))
        return { type: "env", envVar: "DISABLE_AUTOUPDATER" };
    
    // 2. Settings — but native installs have a protection flag
    let settings = getSettings();
    if (settings.autoUpdates === false
        && (settings.installMethod !== "native"
            || settings.autoUpdatesProtectedForNative !== true))
        return { type: "config" };
    
    return null;  // auto-update enabled
}
```

**Important:** For native installs, `autoUpdates: false` in settings.json is **not sufficient** — the code checks `autoUpdatesProtectedForNative` and may ignore the setting. The `DISABLE_AUTOUPDATER` environment variable bypasses this check entirely, which is why it's the recommended approach.

**After disabling**, verify the symlink points to your desired version:

```bash
# Check current version
ls -la ~/.local/bin/claude
# Should show: claude -> ~/.local/share/claude/versions/2.1.92

# If not, re-point manually:
ln -sf ~/.local/share/claude/versions/2.1.92 ~/.local/bin/claude

# Verify
claude --version
```

**Retained versions** can be listed with:

```bash
ls ~/.local/share/claude/versions/
```

Old versions are eventually purged when new ones are downloaded. With auto-updates disabled, no new versions are downloaded and your current set is preserved.

**Combine with tweakcc** for the full solution: disable auto-updates to pin the version, then use tweakcc to patch the Output efficiency section out of the binary. After a (manual) update, reapply with `npx tweakcc --apply`.

### Strategy 2: npm install (version pinning via package manager)

npm retains all published versions indefinitely. As of 2026-04-13, every version from 0.x through 2.1.104 is available on the registry.

```bash
# Install a specific version globally
npm install -g @anthropic-ai/claude-code@2.1.92

# Verify
claude --version
# 2.1.92 (Claude Code)

# To update later (manually):
npm install -g @anthropic-ai/claude-code@2.1.104
```

**Pros:**
- Exact version pinning — npm never auto-updates global packages
- All historical versions available (`npm view @anthropic-ai/claude-code versions`)
- Can run a specific version without installing: `npx @anthropic-ai/claude-code@2.1.92`

**Cons:**
- **npm install is deprecated by Anthropic.** The CLI shows a deprecation warning encouraging migration to the native installer. This path may stop working in a future version.
- **npm deprecation may remove old versions.** Anthropic could unpublish older packages (though npm policy makes this difficult for packages with dependents).
- **Requires Node.js.** The native binary is self-contained; npm requires a Node.js installation.
- **No tweakcc `unpack`/`repack`.** tweakcc's binary extraction tools are designed for native binaries. For npm installs, tweakcc patches `cli.js` directly (simpler, but different code path).

**If switching from native to npm**, remove the native binary first to avoid conflicts:

```bash
# Remove native binary
rm ~/.local/bin/claude
rm -rf ~/.local/share/claude/

# Install via npm
npm install -g @anthropic-ai/claude-code@2.1.92
```

**If switching from npm to native:**

```bash
# Remove npm global package
npm uninstall -g @anthropic-ai/claude-code

# Verify it's gone (should return "not found")
which claude

# Install native binary
curl -fsSL https://claude.ai/install.sh | bash

# Verify
claude --version

# Pin immediately if desired
echo '  "env": { "DISABLE_AUTOUPDATER": "1" }' # add to ~/.claude/settings.json
```

Note: the native installer places the binary at `~/.local/bin/claude` (symlink) pointing to `~/.local/share/claude/versions/<version>`. If `~/.local/bin` is not in your `PATH`, the installer will tell you to add it. Settings, sessions, and project config in `~/.claude/` are shared between both install methods — switching does not lose your configuration.

### Backing up and re-downloading native binaries

Native binaries are ~220MB ELF executables stored in `~/.local/share/claude/versions/`. The auto-updater retains a few recent versions but eventually purges old ones. Back them up before they're lost.

**Backup locally retained versions:**

```bash
# List what you have
ls -lh ~/.local/share/claude/versions/

# Backup to a safe location
mkdir -p ~/claude-backups
cp ~/.local/share/claude/versions/2.1.92 ~/claude-backups/claude-2.1.92
cp ~/.local/share/claude/versions/2.1.104 ~/claude-backups/claude-2.1.104

# Verify the backup works
~/claude-backups/claude-2.1.92 --version
```

**Re-downloading from Anthropic's servers:**

All native binaries are hosted on a public GCS bucket with no authentication required. The URL pattern (extracted from the v2.1.92 binary source):

```
Base URL: https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases
Manifest: {base}/{version}/manifest.json
Binary:   {base}/{version}/{platform}/claude
```

Platforms: `linux-x64`, `linux-arm64`, `linux-x64-musl`, `linux-arm64-musl`, `darwin-x64`, `darwin-arm64`, `win32-x64`, `win32-arm64`

**Download a specific version:**

```bash
VERSION="2.1.92"
PLATFORM="linux-x64"  # adjust for your system
BASE="https://storage.googleapis.com/claude-code-dist-86c565f3-f756-42ad-8dfa-d59b1c096819/claude-code-releases"

# Check the manifest (optional — shows all platforms, checksums, sizes)
curl -s "$BASE/$VERSION/manifest.json" | jq .

# Download the binary
curl -o ~/claude-backups/claude-$VERSION "$BASE/$VERSION/$PLATFORM/claude"
chmod +x ~/claude-backups/claude-$VERSION

# Verify checksum (from manifest)
EXPECTED=$(curl -s "$BASE/$VERSION/manifest.json" | jq -r ".platforms.\"$PLATFORM\".checksum")
ACTUAL=$(sha256sum ~/claude-backups/claude-$VERSION | cut -d' ' -f1)
[ "$EXPECTED" = "$ACTUAL" ] && echo "Checksum OK" || echo "CHECKSUM MISMATCH"

# Verify it runs
~/claude-backups/claude-$VERSION --version
```

**Install a backed-up version:**

```bash
# Copy into the versions directory
cp ~/claude-backups/claude-2.1.92 ~/.local/share/claude/versions/2.1.92
chmod +x ~/.local/share/claude/versions/2.1.92

# Point the symlink
ln -sf ~/.local/share/claude/versions/2.1.92 ~/.local/bin/claude

# Verify
claude --version
```

**Notes:**
- The GCS bucket URL contains a UUID (`86c565f3-f756-42ad-8dfa-d59b1c096819`) which could change in future versions. If downloads fail, extract the current URL from a working binary: `strings $(which claude) | grep storage.googleapis.com`
- Not all version numbers may have native binaries — native builds started later than npm packages. Very old versions (pre-2.0) may not be available.
- The server-side minimum version check still applies regardless of how you obtained the binary. A backed-up version can stop working if Anthropic bumps the floor.

### Strategy comparison

| Factor | Native + DISABLE_AUTOUPDATER | npm pinning |
|--------|:---:|:---:|
| Exact version lock | Yes (with symlink management) | Yes (inherent) |
| Auto-update prevention | Via env var | Inherent (npm never auto-updates) |
| Historical versions available | Only what's locally retained | All versions on registry |
| tweakcc compatibility | Full (unpack/repack + config) | Partial (cli.js patching only) |
| Anthropic support status | Supported install method | Deprecated |
| Requires Node.js | No | Yes |
| Server-side minimum version | Still enforced | Still enforced |

**Note:** Both strategies are subject to server-side minimum version enforcement. If Anthropic bumps the minimum version floor past your pinned version, it will refuse to start regardless of install method. See [version downgrade constraints](research/claude-code-internals/token-inflation-46917.md#version-downgrade-constraints).

---

## No clean version exists (as of 2026-04-13)

Three independent issues affect Claude Code quality. **No single version is free of all three.** Every version requires at least one workaround.

### The three regression factors

| # | Factor | Cause | Introduced | Removed/fixed |
|---|--------|-------|-----------|---------------|
| 1 | **Adaptive thinking** | Model decides per-turn how deeply to think, sometimes allocates zero reasoning tokens | Opus 4.6 launch (Feb 9) | Not removed — opt out via `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` |
| 2 | **Medium effort default** | `effort=85` reduced thinking budgets from high to medium | v2.1.68 (Mar 4) | Configurable since v2.1.72 (`/effort`), v2.1.76 (`effortLevel` setting). Default raised to high for API/Team/Enterprise in v2.1.94, but **still medium for Max/Pro** |
| 3 | **Output efficiency strategy directives** | System prompt includes "try the simplest approach first", "do not overdo it" — steers model toward shallow solutions | v2.1.64 (Mar 3) | Removed in v2.1.100 (Apr 10). **No settings toggle** — CLAUDE.md override is unreliable (see [limitation analysis](#claudemd-override-partial-mitigation-only)); [tweakcc](#tweakcc-system-prompt-patching) can remove it from the binary |

A fourth issue, unrelated to reasoning quality:

| # | Factor | Cause | Introduced | Removed/fixed |
|---|--------|-------|-----------|---------------|
| 4 | **Server-side token inflation** | ~20K extra `cache_creation_input_tokens` per request, server-side | v2.1.100 (Apr 10) | Open ([#46917](https://github.com/anthropics/claude-code/issues/46917)), status unknown on v2.1.104 |

### Version tradeoff matrix

| Version range | Factor 1: Adaptive thinking | Factor 2: Effort default | Factor 3: Output efficiency prompt | Factor 4: Token inflation | Available controls |
|---------------|:--:|:--:|:--:|:--:|---|
| **v2.1.63** (Feb 28) | On | High (pre-medium) | Not present | No | `DISABLE_ADAPTIVE_THINKING` only — no `/effort`, no `effortLevel` |
| **v2.1.64–v2.1.65** (Mar 3) | On | High (pre-medium) | **Present** | No | `DISABLE_ADAPTIVE_THINKING` only |
| **v2.1.66–v2.1.68** (Mar 4) | On | **Medium (newly introduced)** | Gap (removed, re-added v2.1.69) | No | `DISABLE_ADAPTIVE_THINKING` only — no way to raise effort back |
| **v2.1.69–v2.1.71** (Mar 5–9) | On | Medium | **Present** | No | `DISABLE_ADAPTIVE_THINKING` only |
| **v2.1.72–v2.1.88** (Mar 10–31) | On | Medium | Present | No | `/effort`, `DISABLE_ADAPTIVE_THINKING` |
| **v2.1.89–v2.1.99** (Apr 1–9) | On | Medium | Present | No | `/effort`, `effortLevel`, `showThinkingSummaries`, `DISABLE_ADAPTIVE_THINKING` |
| **v2.1.100+** (Apr 10+) | On | Medium | **Removed** | **~20K extra tokens** | All controls available |

Reading the table:
- **Bold** = regression factor active in that range
- Factors 1 and 2 are configurable via settings on v2.1.72+
- Factor 3 has no settings toggle — CLAUDE.md override is unreliable; [tweakcc](#tweakcc-system-prompt-patching) can remove it; or upgrade to v2.1.100+ where it's gone
- Factor 4 has no user-side fix except downgrading

### The tradeoff

There are three defensible positions as of April 2026:

#### Option A: v2.1.89–v2.1.99 + settings + tweakcc (recommended)

Fixes all three reasoning factors reliably. Avoids token inflation. Requires reapplying the tweakcc patch after each Claude Code update.

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

```bash
# Remove the Output efficiency section from the binary
npx tweakcc
# → use the interactive TUI to customize/remove the Output efficiency system prompt
# After each Claude Code update: npx tweakcc --apply
```

| Factor | Status | Fix |
|--------|--------|-----|
| 1. Adaptive thinking | Fixed | `DISABLE_ADAPTIVE_THINKING=1` |
| 2. Medium effort | Fixed | `effortLevel: "high"` |
| 3. Output efficiency prompt | **Removed from binary** | tweakcc patch |
| 4. Token inflation | Not present | — |

#### Option B: v2.1.89–v2.1.99 + settings + CLAUDE.md override (if tweakcc is not acceptable)

Same as Option A but uses a CLAUDE.md override instead of tweakcc to address Factor 3. Simpler, no binary patching, but **Factor 3 mitigation is unreliable** — the CLAUDE.md override directly contradicts the system prompt and the model may follow either instruction non-deterministically (see [limitation analysis](#claudemd-override-partial-mitigation-only)).

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

```markdown
<!-- CLAUDE.md (project or ~/.claude/CLAUDE.md) -->
When facing complex tasks: read all relevant files before editing, consider edge
cases, validate the design before coding. Do not default to the simplest approach —
default to the correct approach, even when it takes longer. If unsure, investigate
rather than guess.
```

| Factor | Status | Fix |
|--------|--------|-----|
| 1. Adaptive thinking | Fixed | `DISABLE_ADAPTIVE_THINKING=1` |
| 2. Medium effort | Fixed | `effortLevel: "high"` |
| 3. Output efficiency prompt | **Partially mitigated** | CLAUDE.md override (non-deterministic, see [limitations](#claudemd-override-partial-mitigation-only)) |
| 4. Token inflation | Not present | — |

#### Option C: v2.1.100+ (latest) + settings (if token inflation is acceptable)

Gets the clean removal of the Output efficiency prompt by Anthropic. No binary patching, no CLAUDE.md contradictions. But pays ~20K extra tokens per request until [#46917](https://github.com/anthropics/claude-code/issues/46917) is resolved.

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

| Factor | Status | Fix |
|--------|--------|-----|
| 1. Adaptive thinking | Fixed | `DISABLE_ADAPTIVE_THINKING=1` |
| 2. Medium effort | Fixed | `effortLevel: "high"` |
| 3. Output efficiency prompt | Removed by Anthropic | — |
| 4. Token inflation | **Active (~40% overhead)** | No user-side fix; monitor [#46917](https://github.com/anthropics/claude-code/issues/46917) |

#### Not recommended: downgrading to v2.1.63 or earlier

You escape Factors 2 and 3, but lose all configuration controls (`/effort`, `effortLevel`, `showThinkingSummaries`) and 5+ months of security patches. Factor 1 (adaptive thinking) is still present — [confirmed by source analysis](research/claude-code-internals/versions/v2.1.63-thinking-config-analysis.md).

---

## Changelog

| Date | Change |
|------|--------|
| 2026-04-13 | Added binary backup/re-download from GCS bucket with URL pattern and checksum verification |
| 2026-04-13 | Added version pinning strategies section (native + DISABLE_AUTOUPDATER, npm pinning, comparison table) |
| 2026-04-13 | Added ToS analysis for tweakcc (Section D.4 reverse engineering clause vs practical tolerance) |
| 2026-04-13 | Added tweakcc section; CLAUDE.md override limitation analysis from live introspection; 3-option tradeoff matrix |
| 2026-04-13 | Added "No clean version exists" overview with tradeoff matrix; added CLAUDE.md override to TL;DR |
| 2026-04-13 | Restructured research into `research/claude-code-internals/` with `versions/` subdir |
| 2026-04-13 | Added research/ directory with v2.1.63 source analysis, output efficiency timeline, token inflation analysis, and feature matrix |
| 2026-04-13 | Updated DISABLE_ADAPTIVE_THINKING section with source analysis proof; added output efficiency to background timeline |
| 2026-04-13 | Added Grok/output-efficiency fact-check section; added v2.1.92 system prompt dump |
| 2026-04-13 | Added #46917 server-side token inflation section with User-Agent workaround analysis |
| 2026-04-12 | Initial doc created from #42796 reference material |

---

## Appendix: System prompt reference

A full dump of the Claude Code v2.1.92 system prompt (as seen by the model) is available at [v2.1.92-system-prompt.md](research/claude-code-internals/versions/v2.1.92-system-prompt.md). This captures the prompt text, section structure, and dynamic injection points. Tool JSON schemas are omitted — see [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) for per-version tool definitions.

## Appendix: Research

Detailed research backing this document lives in [research/claude-code-internals/](research/claude-code-internals/):

- [research/claude-code-internals/versions/v2.1.63-thinking-config-analysis.md](research/claude-code-internals/versions/v2.1.63-thinking-config-analysis.md) — Source code reverse-engineering of v2.1.63's thinking parameter construction
- [research/claude-code-internals/output-efficiency-timeline.md](research/claude-code-internals/output-efficiency-timeline.md) — Version tracking of the Output efficiency prompt
- [research/claude-code-internals/token-inflation-46917.md](research/claude-code-internals/token-inflation-46917.md) — Deep dive into #46917 server-side token inflation
- [research/claude-code-internals/feature-availability-matrix.md](research/claude-code-internals/feature-availability-matrix.md) — Cross-reference of feature availability across versions
- [research/claude-code-internals/README.md](research/claude-code-internals/README.md) — Summary and recommended configuration
