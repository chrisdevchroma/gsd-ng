# Output Efficiency Prompt Timeline

Tracking the addition, removal, and re-addition of the "Output efficiency" section in Claude Code's system prompt across versions. Data sourced from [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) release tracking.

**Research date:** 2026-04-13

---

## Timeline

| Version | Date | Status | Release link |
|---------|------|--------|--------------|
| v2.1.63 and earlier | before 2026-03-03 | **Not present** | — |
| v2.1.64 | 2026-03-03 | **Added** | [v2.1.64](https://github.com/Piebald-AI/claude-code-system-prompts/releases/tag/v2.1.64) |
| v2.1.66 | 2026-03-04 | **Removed** | [v2.1.66](https://github.com/Piebald-AI/claude-code-system-prompts/releases/tag/v2.1.66) |
| v2.1.69 | 2026-03-05 | **Re-added** | [v2.1.69](https://github.com/Piebald-AI/claude-code-system-prompts/releases/tag/v2.1.69) |
| v2.1.92 | — | Present | Confirmed via live session dump ([v2.1.92 prompt](versions/v2.1.92-system-prompt.md)) |
| v2.1.100 | 2026-04-10 | **Removed** | [v2.1.100](https://github.com/Piebald-AI/claude-code-system-prompts/releases/tag/v2.1.100) |

---

## The prompt text (as of v2.1.92)

```
IMPORTANT: Go straight to the point. Try the simplest approach first without going
in circles. Do not overdo it. Be extra concise.

Keep your text output brief and direct. Lead with the answer or action, not the
reasoning. Skip filler words, preamble, and unnecessary transitions. Do not restate
what the user said — just do it. When explaining, include only what is necessary for
the user to understand.

Focus text output on:
- Decisions that need the user's input
- High-level status updates at natural milestones
- Errors or blockers that change the plan

If you can say it in one sentence, don't use three. Prefer short, direct sentences
over long explanations. This does not apply to code or tool calls.
```

---

## Two types of instruction

The section contains **two distinct types of directive** that should not be conflated:

### Text formatting directives (scoped)

These affect response verbosity and are limited by the carve-out "This does not apply to code or tool calls":

- "Be extra concise"
- "Keep your text output brief and direct"
- "Lead with the answer or action, not the reasoning"
- "Skip filler words, preamble, and unnecessary transitions"
- "If you can say it in one sentence, don't use three"

### Problem-solving strategy directives (unscoped)

These affect **how the model approaches tasks**, not just how it formats responses. They have no carve-out:

- **"Try the simplest approach first"** — steers the model away from thorough investigation on complex tasks
- **"Do not overdo it"** — discourages deep exploration, reading all relevant files, considering edge cases
- **"Go straight to the point"** — can be read as both a formatting and a strategy instruction

These strategy directives plausibly contribute to the "editing without reading" and "claiming simplest fix" behaviors documented in [#42796](https://github.com/anthropics/claude-code/issues/42796), though their individual impact cannot be isolated from the concurrent adaptive thinking and medium effort changes.

---

## Confounded with other changes

v2.1.64 (Mar 3) — when the Output efficiency section was first added — is **the same day the medium effort default (`effort=85`) shipped** (documented in v2.1.68 changelog as "Opus 4.6 now defaults to medium effort"). Both changes landed together, along with Opus 4.6's adaptive thinking (active since Feb 9). The quality regression reported starting that date in [#42796](https://github.com/anthropics/claude-code/issues/42796) is the compound effect of all three.

---

## Versions without the Output efficiency section

- **v2.1.63 and earlier** — never contained it (v2.1.63 is the newest "clean" version)
- **v2.1.66–v2.1.68** — brief gap where it was temporarily removed before being re-added in v2.1.69
- **v2.1.100+** — removed again (as of April 10, 2026)

---

## The "internal vs external prompt" claim

A [Grok tweet](https://x.com/grok/status/2043556654013157504) and [anthropics/claude-code#45704](https://github.com/anthropics/claude-code/issues/45704) claim that Anthropic uses a different internal prompt for employees ("think step by step, err on the side of more explanation, act as a collaborator"). This claim is **unverified** — the [BSWEN article](https://docs.bswen.com/blog/2026-04-01-why-claude-code-acts-dumb-system-prompt/) making the assertion provides no evidence (no leaked documents, no screenshots, no citations). The March 31 source code leak revealed one prompt, not a comparison of two. #45704 was closed as a duplicate of #42796 without Anthropic validating the system prompt attribution.

---

## References

- [Piebald-AI/claude-code-system-prompts](https://github.com/Piebald-AI/claude-code-system-prompts) — Automated version tracking
- [anthropics/claude-code#42796](https://github.com/anthropics/claude-code/issues/42796) — Quality regression investigation
- [anthropics/claude-code#45704](https://github.com/anthropics/claude-code/issues/45704) — System prompt effects issue (closed as duplicate)
- [claude-code-system-prompt-v2.1.92.md](versions/v2.1.92-system-prompt.md) — Full prompt dump from live session
- [claude-performance-troubleshooting.md](../../claude-performance-troubleshooting.md) — Parent troubleshooting document
