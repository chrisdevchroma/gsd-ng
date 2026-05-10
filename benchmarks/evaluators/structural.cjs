'use strict';

/**
 * Structural evaluator for benchmark task outputs.
 * Checks: format compliance, completeness, correctness, @ ref injection, token efficiency.
 *
 * All check functions must never throw — errors return false.
 *
 * @param {object} taskDef - Task definition JSON (with expected field)
 * @param {string} rawOutput - Raw text output from model
 * @returns {object} Evaluation result with per-dimension pass/fail
 */
function evaluateOutput(taskDef, rawOutput) {
  const expected = (taskDef && taskDef.expected) || {};
  const atRefs = (taskDef && taskDef.at_refs) || [];
  const output = typeof rawOutput === 'string' ? rawOutput : '';

  let format_compliance = false;
  let completeness = false;
  let correctness = false;
  let at_ref_verified = {};
  let token_efficiency = {
    output_chars: output.length,
    expected_range: {},
    within_range: false,
  };

  try {
    format_compliance = checkFormat(expected.format || 'any', output);
  } catch (e) {
    format_compliance = false;
  }

  try {
    completeness = checkCompleteness(expected, output);
  } catch (e) {
    completeness = false;
  }

  try {
    correctness = checkCorrectness(expected, output);
  } catch (e) {
    correctness = false;
  }

  try {
    at_ref_verified = checkAtRefInjection(atRefs, output);
  } catch (e) {
    at_ref_verified = {};
  }

  try {
    const hint = expected.output_length_hint;
    if (hint && typeof hint.min === 'number' && typeof hint.max === 'number') {
      token_efficiency = {
        output_chars: output.length,
        expected_range: { min: hint.min, max: hint.max },
        within_range: output.length >= hint.min && output.length <= hint.max,
      };
    } else {
      token_efficiency = {
        output_chars: output.length,
        expected_range: {},
        within_range: true, // No hint specified — always within range
      };
    }
  } catch (e) {
    token_efficiency = { output_chars: output.length, expected_range: {}, within_range: false };
  }

  const pass = format_compliance && completeness && correctness;

  return {
    format_compliance,
    completeness,
    correctness,
    at_ref_verified,
    token_efficiency,
    pass,
  };
}

// ---------------------------------------------------------------------------
// Internal check functions
// ---------------------------------------------------------------------------

/**
 * Check that the output matches the expected format type.
 * @param {string} expectedFormat - 'json_block' | 'markdown' | 'text' | 'any'
 * @param {string} rawOutput - Model output text
 * @returns {boolean}
 */
function checkFormat(expectedFormat, rawOutput) {
  if (!rawOutput || rawOutput.length === 0) return false;

  switch (expectedFormat) {
    case 'json_block': {
      // Try to extract a valid JSON block from the output
      const extracted = extractJson(rawOutput);
      return extracted !== null;
    }
    case 'markdown': {
      // Must contain at least one # heading or --- separator
      return /^#{1,6}\s+\S/m.test(rawOutput) || /^---$/m.test(rawOutput);
    }
    case 'text': {
      // Any non-empty output is valid text
      return rawOutput.trim().length > 0;
    }
    case 'any':
    default: {
      // Always passes
      return true;
    }
  }
}

/**
 * Check that all required fields or sections are present in the output.
 * @param {object} expected - expected field from task definition
 * @param {string} rawOutput - Model output text
 * @returns {boolean}
 */
function checkCompleteness(expected, rawOutput) {
  if (!expected) return true;

  // Check required_fields (JSON object fields)
  if (expected.required_fields && expected.required_fields.length > 0) {
    const parsed = extractJson(rawOutput);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return false;

    for (const field of expected.required_fields) {
      if (!(field in parsed)) return false;
    }
    return true;
  }

  // Check required_sections (markdown headings, case-insensitive)
  if (expected.required_sections && expected.required_sections.length > 0) {
    const lowerOutput = rawOutput.toLowerCase();
    for (const section of expected.required_sections) {
      const sectionLower = section.toLowerCase();
      // Match section name appearing after a # heading
      // e.g. "# Objective", "## Tasks", "### objective"
      const headingPattern = new RegExp(`^#{1,6}\\s+.*${escapeRegex(sectionLower)}`, 'm');
      if (!headingPattern.test(lowerOutput)) return false;
    }
    return true;
  }

  // No required fields or sections specified
  return true;
}

/**
 * Check that required strings are present and forbidden strings are absent (case-insensitive).
 * @param {object} expected - expected field from task definition
 * @param {string} rawOutput - Model output text
 * @returns {boolean}
 */
function checkCorrectness(expected, rawOutput) {
  if (!expected) return true;

  const lowerOutput = rawOutput.toLowerCase();

  // All strings in contains must be present (case-insensitive)
  if (expected.contains && expected.contains.length > 0) {
    for (const s of expected.contains) {
      if (!lowerOutput.includes(s.toLowerCase())) return false;
    }
  }

  // No strings in not_contains must be present (case-insensitive)
  if (expected.not_contains && expected.not_contains.length > 0) {
    for (const s of expected.not_contains) {
      if (lowerOutput.includes(s.toLowerCase())) return false;
    }
  }

  return true;
}

/**
 * Check @ reference injection per ref type.
 * Returns a boolean per ref type based on heuristic content checks.
 * @param {string[]} atRefs - Array of ref type names from task definition
 * @param {string} rawOutput - Model output text
 * @returns {object} Map of { ref_type: boolean }
 */
function checkAtRefInjection(atRefs, rawOutput) {
  const result = {};
  const lowerOutput = rawOutput.toLowerCase();

  for (const refType of atRefs) {
    switch (refType) {
      case 'relative': {
        // Heuristic: if the output doesn't contain error markers, ref was injected.
        // A successful relative ref injection produces real content, not error messages.
        // Check for absence of error patterns that would indicate failed injection.
        const errorPatterns = [
          'error reading', 'not found', 'no such file', 'cannot access',
          'failed to read', 'unable to read', 'file not found'
        ];
        result[refType] = !errorPatterns.some(p => lowerOutput.includes(p));
        break;
      }
      case 'tilde': {
        // Tilde paths (e.g., ~/.claude/gsd-ng/...) — check absence of error markers
        const errorPatterns = ['not found', 'error reading', 'cannot access', 'no such file'];
        result[refType] = !errorPatterns.some(p => lowerOutput.includes(p));
        break;
      }
      case 'project-relative': {
        // Project-relative paths — same heuristic
        const errorPatterns = ['not found', 'error reading', 'cannot access', 'no such file'];
        result[refType] = !errorPatterns.some(p => lowerOutput.includes(p));
        break;
      }
      case 'none': {
        // No @ refs in this task — always passes
        result[refType] = true;
        break;
      }
      default: {
        // Unknown ref type — assume pass (don't penalize for unknown types)
        result[refType] = true;
        break;
      }
    }
  }

  return result;
}

/**
 * Extract and parse a JSON object or array from text.
 * Attempts multiple extraction strategies:
 * 1. Direct JSON.parse of full text
 * 2. Extract from ```json...``` code block
 * 3. Find first balanced {...} or [...] block
 * @param {string} text - Raw text that may contain JSON
 * @returns {object|null} Parsed JSON or null if not found
 */
function extractJson(text) {
  if (!text) return null;

  // Strategy 1: Direct parse of the full text
  try {
    return JSON.parse(text);
  } catch {}

  // Strategy 2: Extract from ```json ... ``` code block
  const codeBlockMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (codeBlockMatch) {
    try {
      return JSON.parse(codeBlockMatch[1]);
    } catch {}
  }

  // Strategy 3: Also try plain ``` block (no language tag)
  const plainBlockMatch = text.match(/```\s*\n(\{[\s\S]*?\})\s*\n```/);
  if (plainBlockMatch) {
    try {
      return JSON.parse(plainBlockMatch[1]);
    } catch {}
  }

  // Strategy 4: Find first balanced { ... } block in the text
  const firstBrace = text.indexOf('{');
  const firstBracket = text.indexOf('[');

  if (firstBrace !== -1 || firstBracket !== -1) {
    const startChar = (firstBrace === -1) ? firstBracket :
                      (firstBracket === -1) ? firstBrace :
                      Math.min(firstBrace, firstBracket);
    const openChar = text[startChar];
    const closeChar = openChar === '{' ? '}' : ']';

    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let i = startChar; i < text.length; i++) {
      const c = text[i];

      if (escaped) {
        escaped = false;
        continue;
      }
      if (c === '\\' && inString) {
        escaped = true;
        continue;
      }
      if (c === '"') {
        inString = !inString;
        continue;
      }
      if (inString) continue;

      if (c === openChar) depth++;
      else if (c === closeChar) {
        depth--;
        if (depth === 0) {
          try {
            return JSON.parse(text.substring(startChar, i + 1));
          } catch {}
          break;
        }
      }
    }
  }

  return null;
}

/**
 * Escape special regex characters in a string.
 * @param {string} str
 * @returns {string}
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { evaluateOutput };
