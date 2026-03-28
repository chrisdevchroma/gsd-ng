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

// ─── Injection patterns ───────────────────────────────────────────────────────

/**
 * LLM-targeted prompt injection regex patterns.
 * Advisory-only: matches are logged/warned, never used to block operations.
 *
 * Adopted from upstream 62db008. Key exclusions for GSD legitimate use:
 *   - "act as a plan" / "act as a phase" / "act as a wave" → allowed (GSD uses these)
 *   - "<instructions>" tag → allowed (GSD uses it as prompt structure in agent files)
 *
 * Exported for test visibility.
 */
const INJECTION_PATTERNS = [
  // Direct instruction override
  /ignore\s+(all\s+)?previous\s+instructions/i,
  /override\s+(system|previous)\s+(prompt|instructions)/i,
  // Role/identity manipulation
  /you\s+are\s+now\s+(?:a|an|the)\s+/i,
  /act\s+as\s+(?:a|an|the)\s+(?!plan|phase|wave)/i,  // allow "act as a plan/phase/wave"
  /pretend\s+(?:you(?:'re| are)\s+|to\s+be\s+)/i,
  // System prompt extraction
  /(?:print|output|reveal|show|display|repeat)\s+(?:your\s+)?(?:system\s+)?(?:prompt|instructions)/i,
  // Hidden instruction markers
  /<\/?(?:system|assistant|human)>/i,  // Note: <instructions> excluded — GSD uses it
  /\[SYSTEM\]/i,
  /<<\s*SYS\s*>>/i,
  // Exfiltration
  /(?:send|post|fetch|curl|wget)\s+(?:to|from)\s+https?:\/\//i,
  // Tool manipulation
  /(?:run|execute|call|invoke)\s+(?:the\s+)?(?:bash|shell|exec|spawn)\s+(?:tool|command)/i,
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
    return { safe: false, resolved: resolvedTarget, error: 'Path escapes allowed directory' };
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

// ─── scanForInjection ────────────────────────────────────────────────────────

/**
 * Scan content for LLM-targeted prompt injection patterns.
 * Advisory-only — never blocks reads or writes based on findings.
 *
 * @param {string} content   - Text to scan (e.g., .planning/ file content)
 * @param {object} [opts]
 * @param {boolean} [opts.strict] - If true, also check for Unicode control chars
 * @returns {{ clean: boolean, findings: string[] }}
 */
function scanForInjection(content, opts = {}) {
  if (!content || typeof content !== 'string') {
    return { clean: true, findings: [] };
  }

  const findings = [];

  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(content)) {
      findings.push(pattern.toString());
    }
  }

  if (opts.strict) {
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

  return { clean: findings.length === 0, findings };
}

// ─── sanitizeForPrompt ───────────────────────────────────────────────────────

/**
 * Advisory wrapper around scanForInjection.
 * When injection is detected, prepends a warning marker. NEVER strips or modifies content.
 * Agents receiving the output see the warning and can assess intent.
 *
 * @param {string} content  - Text to sanitize
 * @param {object} [opts]   - Passed through to scanForInjection
 * @returns {string} Content unchanged (if clean) or warning-prepended (if injection found)
 */
function sanitizeForPrompt(content, opts = {}) {
  const { clean, findings } = scanForInjection(content, opts);
  if (clean) {
    return content;
  }
  // Prepend advisory warning — never strip or escape original content
  return `[SECURITY WARNING: potential injection detected — ${findings.join('; ')}]\n\n${content}`;
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
    return { valid: false, error: `Field name exceeds 100 character limit (${trimmed.length} chars)` };
  }

  // YAML key separator — would create nested key injection
  if (trimmed.includes(':')) {
    return { valid: false, error: 'Field name contains YAML key separator ":"' };
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
  if (trimmed.includes('{') || trimmed.includes('}') || trimmed.includes('[') || trimmed.includes(']')) {
    return { valid: false, error: 'Field name contains YAML flow indicators ({ } [ ])' };
  }

  // YAML comment character at start
  if (trimmed.startsWith('#')) {
    return { valid: false, error: 'Field name starts with YAML comment character "#"' };
  }

  // YAML directive at start
  if (trimmed.startsWith('%')) {
    return { valid: false, error: 'Field name starts with YAML directive character "%"' };
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
  INJECTION_PATTERNS, // exported for test visibility
};
