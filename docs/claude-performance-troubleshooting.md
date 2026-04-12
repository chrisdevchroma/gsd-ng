# Claude Performance & Thinking-Depth Troubleshooting

Reference notes for diagnosing and working around degraded Claude Code behavior. All findings traced to **anthropics/claude-code#42796** (Stella Laurenzo / IREE team, analysis spanning Jan 30 – Apr 1, 2026).

**Maintainer note:** This document is a reference, not a roadmap. When Anthropic ships fixes, annotate the affected section with a date and keep the historical context — the workarounds may rot, but the diagnostic techniques stay useful. Monitor the upstream issue and update when behavior changes.

---

## TL;DR: First-line workarounds

If a session feels degraded — Claude is editing without reading, claiming completion prematurely, dismissing failures as "pre-existing", or ignoring CLAUDE.md instructions — try in this order:

1. **Bump effort for the conversation:** `/effort max`
2. **Check the canaries:** see the Canaries section below — compute Read:Edit ratio from your session logs
3. **Isolate the customization layer:** relaunch with `CLAUDE_CODE_SIMPLE=1 claude` and retry — if behavior improves, the issue is in your customizations (hooks, CLAUDE.md, MCPs), not Claude core
4. **Report with transcripts:** run `/bug` and capture the feedback ID for Anthropic support
5. **Try fixed thinking budgets:** set `CLAUDE_CODE_DISABLE_ADAPTIVE_THINKING=1` in `~/.claude/settings.json` `env` block and relaunch

Each of these is explained in detail below.

---

## Background: What happened in Feb–Mar 2026

The #42796 investigation documented a measurable regression in Claude Opus 4.6 reasoning depth starting February 2026, correlating with two internal changes at Anthropic:

| Date | Change | Effect |
|------|--------|--------|
| 2026-02-09 | Opus 4.6 launch → adaptive thinking default | Model decides per-turn how deep to think instead of fixed budgets |
| 2026-02-12 | `redact-thinking-2026-02-12` beta header rolled out | Thinking summaries hidden from client (UI only) |
| 2026-03-03 | Medium effort (`effort=85`) became default on Opus 4.6 | Latency/cost sweet spot, reduced thinking budget for most users |
| 2026-03-08 | Redacted thinking crossed 50% of responses | Quality regression independently reported this day |
| 2026-03-12 | 100% redacted thinking | All thinking now hidden by default |

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
**Default:** Unset (adaptive thinking enabled since 2026-02-09)
**Effect:** Opts out of Opus 4.6's adaptive thinking mode, reverting to fixed thinking budgets. Independent of `effortLevel` — raising effort does not prevent adaptive from dropping below its budget on a per-turn basis.

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

## Changelog

| Date | Change |
|------|--------|
| 2026-04-12 | Initial doc created from #42796 reference material |
