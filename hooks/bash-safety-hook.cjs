#!/usr/bin/env node
/**
 * bash-safety-hook.cjs — PreToolUse hook for compound bash command allowlist matching
 *
 * Decomposes compound bash commands (&&, ||, ;, |, $() subshells) into individual
 * sub-commands and auto-approves only when ALL sub-commands match the user's
 * allowlist, including shell builtins.
 *
 * Algorithm ported from liberzon/claude-hooks (Python) to Node.js CommonJS.
 * See: https://github.com/liberzon/claude-hooks
 * See: https://github.com/anthropics/claude-code/issues/30435 (#30435)
 * See: https://github.com/anthropics/claude-code/issues/15897 (#15897 — why we don't use updatedInput)
 * See: https://github.com/anthropics/claude-code/issues/16561 (#16561 — compound command root cause)
 *
 * Hook output format (Claude Code PreToolUse):
 *   Allow: {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"allow","permissionDecisionReason":"..."}}
 *   Deny:  {"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"..."}}
 *   Fall-through (no output): exit 0 silently
 *
 * Kill switch: GSD_DISABLE_BASH_HOOK=1 — exits immediately (checked FIRST, before stdin read)
 * Debug logging: GSD_HOOK_DEBUG=1 — writes verbose logs to stderr
 *
 * Settings layers read (CLAUDE_PROJECT_DIR and CLAUDE_SETTINGS_PATH env vars):
 *   Layer 1: $CLAUDE_SETTINGS_PATH || ~/.claude/settings.json
 *   Layer 2: ~/.claude/settings.local.json
 *   Layer 3: $CLAUDE_PROJECT_DIR/.claude/settings.json
 *   Layer 4: $CLAUDE_PROJECT_DIR/.claude/settings.local.json
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');

// ── SAFE_BUILTINS — removed ───────────────────────────────────────────────────
// Previously auto-approved shell builtins (cd, echo, printf, etc.) without any
// allowlist entry. Removed because combining builtins with shell redirection
// (e.g. `echo "x" > ~/.bashrc`, `read var < /etc/shadow`) introduces filesystem
// side effects that bypass allow/deny intent. The Python upstream
// (liberzon/claude-hooks) never had this feature.
//
// Builtins are now approved through the same allowlist path as everything else.
// GSD-NG's settings-sandbox.json template already includes Bash(echo *),
// Bash(cd *), etc. — so sandbox users see no change. Non-sandbox users must
// explicitly allowlist builtins they want auto-approved.

// ── Structural shell keywords — filter these out (not real commands) ──────────
// Control/syntax constructs that are not checkable commands. Includes shell
// syntax markers (done/fi/esac/then/else/elif/do/{/}), loop-control builtins
// (break/continue — accept an optional numeric arg but are not security-
// relevant themselves), and the nullary-idiom builtins true/false (accept
// and ignore any args; common in the `cmd || true` idiom).
//
// INVARIANT (enforced by decomposeCommand): extractSubshells() runs on every
// rawPart BEFORE this filter is consulted. That means a structural keyword
// wrapping a `$()` argument (e.g. `then $(curl evil)`, `break $(curl evil)`,
// `true $(curl evil)`) cannot bypass allow/deny — the inner command is
// pushed to the decomposed result regardless of whether the outer keyword
// is later filtered out here.
//
// exit/return/local/export are NOT in this set — they are real commands that
// must reach the allowlist path (covered by template entries like
// `Bash(local *)`, `Bash(export *)`). `eval` is never filtered or
// allowlisted — it executes arbitrary strings.
const STRUCTURAL_KEYWORDS = new Set([
  'done', 'fi', 'esac', '{', '}', 'break', 'continue',
  'then', 'else', 'elif', 'do',
  'true', 'false',
]);

// ── Compound statement headers — filter from decomposed output ────────────────
// These keywords introduce compound commands but are not executable commands themselves.
const COMPOUND_HEADER_RE = /^(for|while|until|if|case|select)\b/;

// ── Heredoc detection regex ──────────────────────────────────────────────────
// Matches real heredoc operators (<<WORD, <<-WORD, <<'WORD', <<"WORD") while
// excluding here-strings (<<<). Uses (?<!<) lookbehind + (?!<) lookahead:
// without BOTH anchors, the regex engine can match the 2nd+3rd '<' of '<<<'
// as a valid '<<', bypassing a lookahead-only guard. This is an improvement
// over the upstream Python (liberzon/claude-hooks) which uses \w+ — immune
// to '<<<' by accident but unable to match non-word delimiters like EOF-1
// or END.TXT.
//
// Capture groups: (1) single-quoted delimiter, (2) double-quoted, (3) unquoted.
// Use: m[1] || m[2] || m[3] to get the delimiter.
const HEREDOC_START_RE = /(?<!<)<<(?!<)-?\s*(?:'([^'\n]+)'|"([^"\n]+)"|([^\s'"]+))/;

// ── _skipShellValue ───────────────────────────────────────────────────────────
/**
 * Starting at index i in cmd (immediately after `KEY=`), skip over the value
 * and return the index of the first character after the value.
 *
 * Handles: double-quoted strings, single-quoted strings, and unquoted words
 * (including $() subshell values such as `result=$(curl ...)`).
 *
 * Ported from liberzon/claude-hooks smart_approve.py _skip_shell_value().
 *
 * @param {string} cmd - Command string
 * @param {number} i - Index into cmd where the value starts (right after '=')
 * @returns {number} Index of first character after the value
 */
function _skipShellValue(cmd, i) {
  if (i >= cmd.length) return i;
  const ch = cmd[i];
  // Double-quoted string
  if (ch === '"') {
    let j = i + 1;
    while (j < cmd.length) {
      if (cmd[j] === '\\' && j + 1 < cmd.length) { j += 2; continue; }
      if (cmd[j] === '"') return j + 1;
      j++;
    }
    return j;
  }
  // Single-quoted string
  if (ch === "'") {
    let j = i + 1;
    while (j < cmd.length) {
      if (cmd[j] === "'") return j + 1;
      j++;
    }
    return j;
  }
  // Unquoted word — track $() paren depth
  let j = i;
  let parenDepth = 0;
  while (j < cmd.length) {
    if (cmd[j] === '$' && j + 1 < cmd.length && cmd[j + 1] === '(') {
      parenDepth++;
      j += 2;
      continue;
    }
    if (cmd[j] === '(' && parenDepth > 0) { parenDepth++; j++; continue; }
    if (cmd[j] === ')' && parenDepth > 0) {
      parenDepth--;
      j++;
      continue;
    }
    if (parenDepth === 0 && /\s/.test(cmd[j])) break;
    j++;
  }
  return j;
}

// ── isStandaloneAssignment ────────────────────────────────────────────────────
/**
 * Returns true if cmd is a standalone variable assignment with no command following.
 *
 * Handles simple assignments (FOO=bar), quoted assignments (FOO="bar baz"),
 * and subshell assignments (result=$(curl ...)).
 *
 * @param {string} cmd - Normalized command string
 * @returns {boolean}
 */
function isStandaloneAssignment(cmd) {
  const m = cmd.match(/^[A-Za-z_][A-Za-z0-9_]*=/);
  if (!m) return false;
  const end = _skipShellValue(cmd, m[0].length);
  return cmd.slice(end).trim() === '';
}

// ── stripHeredocs ─────────────────────────────────────────────────────────────
/**
 * Strip heredoc bodies from a command string, leaving just the <<DELIM marker line.
 *
 * Heredocs like <<'EOF'\n...\nEOF are replaced with the marker line only
 * (body removed). This prevents heredoc content lines from being treated
 * as sub-commands when splitOnOperators() splits on newlines.
 *
 * Ported from liberzon/claude-hooks smart_approve.py strip_heredocs().
 *
 * @param {string} command - Raw bash command string (may contain newlines)
 * @returns {string} Command with heredoc bodies removed
 */
function stripHeredocs(command) {
  const lines = command.split('\n');
  const result = [];
  let heredocDelim = null;
  let i = 0;

  while (i < lines.length) {
    if (heredocDelim !== null) {
      // Inside heredoc body -- look for the terminator line
      if (lines[i].trim() === heredocDelim) {
        heredocDelim = null;
      }
      i++;
      continue;
    }

    // Check for heredoc marker — uses shared HEREDOC_START_RE (see constant definition)
    const m = lines[i].match(HEREDOC_START_RE);
    if (m) {
      const heredocPos = m.index;
      if (!isInsideQuotes(lines[i], heredocPos)) {
        heredocDelim = m[1] || m[2] || m[3];
      }
    }

    result.push(lines[i]);
    i++;
  }

  return result.join('\n');
}

// ── isInsideQuotes ────────────────────────────────────────────────────────────
/**
 * Check if position idx in line falls inside a quoted string.
 * Left-to-right scan tracking single/double quote toggle state.
 *
 * @param {string} line - The line to check
 * @param {number} idx  - Position to test
 * @returns {boolean} true if idx is inside a quoted region
 */
function isInsideQuotes(line, idx) {
  let inSingle = false;
  let inDouble = false;
  for (let j = 0; j < idx; j++) {
    const c = line[j];
    if (c === "'" && !inDouble) {
      inSingle = !inSingle;
    } else if (c === '"' && !inSingle) {
      inDouble = !inDouble;
    } else if (c === '\\' && inDouble && j + 1 < idx) {
      j++; // skip escaped char inside double quotes
    }
  }
  return inSingle || inDouble;
}

// ── splitOnOperators ──────────────────────────────────────────────────────────
/**
 * Split a compound bash command string on operators: &&, ||, ;, |, newline.
 * Uses a character-by-character state machine to correctly handle:
 *   - Single-quoted strings (no escapes inside)
 *   - Double-quoted strings (backslash escapes allowed)
 *   - $() subshells (tracked by depth, no split inside)
 *   - Backtick subshells (legacy `cmd`)
 *
 * Ported from liberzon/claude-hooks smart_approve.py split_on_operators().
 *
 * @param {string} command - Raw bash command string
 * @returns {string[]} Array of sub-command strings (may need trimming/normalizing)
 */
function splitOnOperators(command) {
  command = command.replace(/\\\n/g, ' ');
  const parts = [];
  let current = '';
  let singleQuote = false;
  let doubleQuote = false;
  let depth = 0; // $() subshell depth
  let backtick = false;
  let i = 0;

  while (i < command.length) {
    const ch = command[i];
    const next = command[i + 1] || '';

    // ── Single quote state ──
    if (ch === "'" && !doubleQuote && !singleQuote && depth === 0) {
      singleQuote = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === "'" && singleQuote) {
      singleQuote = false;
      current += ch;
      i++;
      continue;
    }
    // Inside single quotes: no escapes, no special chars
    if (singleQuote) {
      current += ch;
      i++;
      continue;
    }

    // ── Double quote state ──
    if (ch === '"' && !doubleQuote && depth === 0) {
      doubleQuote = true;
      current += ch;
      i++;
      continue;
    }
    if (ch === '"' && doubleQuote) {
      doubleQuote = false;
      current += ch;
      i++;
      continue;
    }
    // Inside double quotes: allow backslash escapes
    if (doubleQuote) {
      if (ch === '\\' && next) {
        current += ch + next;
        i += 2;
        continue;
      }
      // Track $() inside double quotes for depth — consume $( as a unit (i += 2)
      // to prevent the '(' being re-processed by the bare-paren handler
      if (ch === '$' && next === '(') {
        depth++;
        current += ch + next;
        i += 2;
        continue;
      }
      if (ch === ')' && depth > 0) {
        depth--;
        current += ch;
        i++;
        continue;
      }
      current += ch;
      i++;
      continue;
    }

    // ── Outside quotes ──

    // Backslash escape
    if (ch === '\\' && next) {
      current += ch + next;
      i += 2;
      continue;
    }

    // $( — enter subshell. Consume $( as a unit (i += 2) so the '(' is not
    // re-processed by the bare-paren handler, which would double-increment depth.
    // Python upstream: i += 2. Without this, depth stays >0 after the closing ')',
    // preventing operator splitting — a security bypass.
    if (ch === '$' && next === '(') {
      depth++;
      current += ch + next;
      i += 2;
      continue;
    }

    // ( — track nested parens inside subshell
    if (ch === '(' && depth > 0) {
      depth++;
      current += ch;
      i++;
      continue;
    }

    // Backtick subshell (legacy `cmd`)
    if (ch === '`') {
      backtick = !backtick;
      current += ch;
      i++;
      continue;
    }

    // ) — exit subshell
    if (ch === ')' && depth > 0) {
      depth--;
      current += ch;
      i++;
      continue;
    }

    // Inside subshell or backtick: don't split
    if (depth > 0 || backtick) {
      current += ch;
      i++;
      continue;
    }

    // ── Operator detection (only at depth==0, outside quotes) ──

    // && operator
    if (ch === '&' && next === '&') {
      parts.push(current);
      current = '';
      i += 2;
      continue;
    }

    // || operator
    if (ch === '|' && next === '|') {
      parts.push(current);
      current = '';
      i += 2;
      continue;
    }

    // | pipe (single, not part of ||)
    if (ch === '|') {
      parts.push(current);
      current = '';
      i++;
      continue;
    }

    // ; semicolon
    if (ch === ';') {
      parts.push(current);
      current = '';
      i++;
      continue;
    }

    // Newline
    if (ch === '\n') {
      parts.push(current);
      current = '';
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Push trailing part
  if (current !== '') {
    parts.push(current);
  }

  return parts;
}

// ── normalizeCommand ──────────────────────────────────────────────────────────
/**
 * Normalize a single (already-split) sub-command string:
 *   1. Strip heredoc body (<< WORD ... WORD)
 *   2. Strip leading keyword prefixes (do, then, else, elif)
 *   3. Strip leading env var assignments (KEY=value KEY2=value2 ...)
 *   4. Strip trailing redirections (>, >>, <, 2>&1, etc.)
 *   5. Collapse whitespace and trim
 *
 * Returns empty string for structural keywords and standalone assignments.
 *
 * Ported from liberzon/claude-hooks smart_approve.py normalize_command().
 *
 * @param {string} cmd - Single sub-command string (pre-split)
 * @returns {string} Normalized command (may be empty string)
 */
function normalizeCommand(cmd) {
  let s = cmd.trim();
  if (!s) return '';

  // Strip heredoc/here-string redirection: << WORD ... (remove << marker and everything after)
  // Uses shared HEREDOC_START_RE to exclude here-strings (<<<), then strips the rest of the line.
  s = s.replace(new RegExp(HEREDOC_START_RE.source + '\\s*.*$', 's'), '').trim();

  // Strip keyword prefixes: do, then, else, elif (at start of command)
  s = s.replace(/^(do|then|else|elif)\s+/, '');

  // Strip leading env var prefixes: KEY=value KEY2=value ...
  // Uses _skipShellValue to correctly handle quoted values and $() subshell values.
  while (true) {
    const m = s.match(/^[A-Za-z_][A-Za-z0-9_]*=/);
    if (!m) break;
    const endVal = _skipShellValue(s, m[0].length);
    const rest = s.slice(endVal).trimStart();
    if (!rest) break;  // standalone assignment — stop stripping, keep as-is
    s = rest;
  }

  // Strip trailing redirections: >, >>, <, 2>&1, &>, /dev/null, etc.
  // Simple approach: strip common redirection patterns from the end
  // Remove: 2>&1, &>, &>>, >>, >, <, followed by optional filename
  s = s.replace(/\s+[0-9]*>>?\s*\S+$/, '');
  s = s.replace(/\s+[0-9]*>&[0-9]+$/, '');
  s = s.replace(/\s+&>>?\s*\S+$/, '');
  s = s.replace(/\s+<\s*\S+$/, '');

  // Also strip 2>&1 appearing anywhere at end
  s = s.replace(/\s+2>&1$/, '');

  // Collapse internal whitespace
  s = s.replace(/\s+/g, ' ').trim();

  return s;
}

// ── decomposeCommand ──────────────────────────────────────────────────────────
/**
 * Decompose a compound bash command into an array of individual command strings.
 *
 * Steps:
 *   1. Split on operators (&&, ||, ;, |, newline) using state machine
 *   2. For each token, extract $() subshell contents recursively
 *   3. Normalize each token
 *   4. Filter out structural keywords (done/fi/esac/{/}/break/continue) and
 *      standalone assignments (FOO=bar with no command following)
 *
 * @param {string} command - Full compound bash command
 * @returns {string[]} Flat array of normalized individual command strings
 */
function decomposeCommand(command) {
  if (!command || !command.trim()) return [];

  const rawParts = splitOnOperators(stripHeredocs(command));
  const result = [];

  for (const part of rawParts) {
    // Extract $() and backtick subshell contents FIRST, unconditionally.
    //
    // Invariant: structural keywords (then/else/elif/do/break/continue) can
    // wrap a $() argument (e.g. `then $(curl ...)`, `break $(curl ...)`).
    // If we filtered on firstWord BEFORE extracting, those keyword-wrapped
    // subshells would silently bypass allow/deny. Running extractSubshells
    // on the raw `part` first guarantees every inner command is checked
    // independently of whether the outer part is later filtered out as
    // structural.
    const subshells = extractSubshells(part);
    for (const sub of subshells) {
      const subParts = splitOnOperators(sub);
      for (const sp of subParts) {
        const norm = normalizeCommand(sp);
        if (norm && !STRUCTURAL_KEYWORDS.has(norm) && !STRUCTURAL_KEYWORDS.has(norm.split(/\s+/)[0]) && !COMPOUND_HEADER_RE.test(norm)) {
          if (!isStandaloneAssignment(norm)) {
            result.push(norm);
          }
        }
      }
    }

    // Now decide whether to push the outer part. Structural keywords,
    // compound-statement headers, and standalone assignments are filtered.
    const normalized = normalizeCommand(part);
    if (!normalized) continue;

    const firstWord = normalized.split(/\s+/)[0];
    if (STRUCTURAL_KEYWORDS.has(firstWord)) continue;
    if (STRUCTURAL_KEYWORDS.has(normalized)) continue;
    if (COMPOUND_HEADER_RE.test(firstWord)) continue;
    if (isStandaloneAssignment(normalized)) continue;

    result.push(normalized);
  }

  return result;
}

/**
 * Extract contents of $() and backtick subshells recursively.
 * Returns array of subshell content strings (inner commands only).
 * Adapted from liberzon/claude-hooks extract_subshells().
 *
 * Uses a state machine for both $() and backtick scanning to correctly handle:
 *   - Single-quoted strings (no escapes inside — ) and ` are literal)
 *   - Double-quoted strings (backslash escapes allowed)
 *   - Backslash escapes outside quotes (skip next char)
 *
 * @param {string} command
 * @returns {string[]}
 */
function extractSubshells(command) {
  const subshells = [];
  let i = 0;

  // Extract $(...) — state machine tracks quotes/escapes, skips $((...)) arithmetic
  while (i < command.length) {
    if (command[i] === '$' && i + 1 < command.length && command[i + 1] === '('
        && !(i + 2 < command.length && command[i + 2] === '(')) {
      // Found $(  — scan forward to the matching ) using a state machine
      let depth = 1; // we've consumed the opening (
      const start = i + 2;
      let j = i + 2;
      let sqInner = false;
      let dqInner = false;

      while (j < command.length && depth > 0) {
        const c = command[j];

        // Inside single quotes: nothing is special except the closing '
        if (sqInner) {
          if (c === "'") sqInner = false;
          j++;
          continue;
        }

        // Backslash escape (outside single quotes): skip next char
        if (c === '\\') {
          j += 2;
          continue;
        }

        // Double-quote toggle
        if (c === '"') {
          dqInner = !dqInner;
          j++;
          continue;
        }

        // Inside double quotes: only backslash and " are special (parens are literal)
        if (dqInner) {
          j++;
          continue;
        }

        // Single-quote open (outside double quotes)
        if (c === "'") {
          sqInner = true;
          j++;
          continue;
        }

        // Track nested $() depth
        if (c === '(') {
          depth++;
        } else if (c === ')') {
          depth--;
          if (depth === 0) {
            const content = command.slice(start, j);
            subshells.push(content);
            // Recurse for nested subshells
            subshells.push(...extractSubshells(content));
            break;
          }
        }

        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }

  // Extract backtick subshells using state-machine (no nesting in bash)
  // Tracks singleQuote, doubleQuote, and backslash escape to correctly identify
  // unescaped backtick delimiters vs literal/escaped backticks.
  {
    let sq = false;
    let dq = false;
    let btStart = -1; // index after opening backtick, or -1 if not in backtick
    let k = 0;

    while (k < command.length) {
      const c = command[k];

      // Inside single quotes: only closing ' is special
      if (sq) {
        if (c === "'") sq = false;
        k++;
        continue;
      }

      // Backslash escape (outside single quotes): skip next char entirely
      if (c === '\\') {
        k += 2;
        continue;
      }

      // Double-quote toggle
      if (c === '"' && btStart === -1) {
        // Only toggle dq when NOT inside a backtick subshell
        // (inside backtick, we do want to find the closing backtick)
        dq = !dq;
        k++;
        continue;
      }

      // Single-quote open (outside double quotes and outside backtick)
      if (c === "'" && !dq && btStart === -1) {
        sq = true;
        k++;
        continue;
      }

      // Backtick handling: inside single quotes or escaped — already handled above
      if (c === '`') {
        if (dq) {
          // Backtick inside double quotes IS a subshell in bash — extract it
          if (btStart === -1) {
            // Opening backtick inside double quotes
            btStart = k + 1;
          } else {
            // Closing backtick
            const content = command.slice(btStart, k);
            if (content.trim()) {
              subshells.push(content);
              subshells.push(...extractSubshells(content));
            }
            btStart = -1;
          }
        } else if (btStart === -1) {
          // Opening backtick outside quotes
          btStart = k + 1;
        } else {
          // Closing backtick outside quotes
          const content = command.slice(btStart, k);
          if (content.trim()) {
            subshells.push(content);
            subshells.push(...extractSubshells(content));
          }
          btStart = -1;
          dq = false; // reset in case we were inside dq for this backtick
        }
        k++;
        continue;
      }

      k++;
    }
  }

  return subshells;
}

// ── parseBashPattern ──────────────────────────────────────────────────────────
/**
 * Parse a Bash() permission pattern from settings.json.
 *
 * Pattern formats:
 *   "Bash(git:*)"       -> prefix="git", matches commands starting with "git "
 *   "Bash(npm run:*)"   -> prefix="npm run", matches commands starting with "npm run "
 *   "Bash(git status)"  -> prefix match (matches "git status" and "git status --porcelain")
 *   "Bash(*)"           -> matches everything
 *
 * Returns null if the string is not a Bash() pattern.
 *
 * @param {string} pattern - Raw permission pattern string
 * @returns {{ type: 'prefix', prefix: string } | { type: 'glob', prefix: string, regex: RegExp } | { type: 'any' } | null}
 */
function parseBashPattern(pattern) {
  if (typeof pattern !== 'string') return null;

  // Must start with Bash( and end with )
  if (!pattern.startsWith('Bash(') || !pattern.endsWith(')')) return null;

  const inner = pattern.slice(5, -1); // strip "Bash(" and ")"

  if (inner === '*') {
    return { type: 'any' };
  }

  // Check for colon separator: "cmd:glob"
  const colonIdx = inner.indexOf(':');
  if (colonIdx !== -1) {
    const prefix = inner.slice(0, colonIdx);
    const globPart = inner.slice(colonIdx + 1);

    if (globPart === '*') {
      // Match anything starting with prefix (with or without trailing args)
      return { type: 'prefix', prefix };
    }

    // Convert glob to regex: * -> .*, ? -> ., escape metacharacters
    const regex = globToRegex(prefix + (globPart ? ' ' + globPart : ''));
    return { type: 'glob', prefix, regex };
  }

  // No colon — exact or glob match against full command
  // Fix for Bug 10: patterns ending with " *" (e.g. "echo *", "gh pr *")
  // should match zero-arg case. Treat as prefix match instead of glob.
  if (inner.endsWith(' *') && !inner.slice(0, -2).includes('*') && !inner.includes('?')) {
    return { type: 'prefix', prefix: inner.slice(0, -2) };
  }
  // Fall through to regex for non-trailing-star globs (e.g. "*.sh", "test?")
  if (inner.includes('*') || inner.includes('?')) {
    const regex = globToRegex(inner);
    return { type: 'glob', prefix: inner.split(/[*?]/)[0].trim(), regex };
  }

  // Exact prefix match
  return { type: 'prefix', prefix: inner };
}

/**
 * Convert a shell glob pattern to a RegExp.
 * Only * and ? are glob metacharacters; others are escaped.
 *
 * @param {string} glob - Glob pattern string
 * @returns {RegExp}
 */
function globToRegex(glob) {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const regexStr = '^' + escaped.replace(/\*/g, '.*').replace(/\?/g, '.') + '$';
  return new RegExp(regexStr, 'i');
}

// ── commandMatchesPattern ─────────────────────────────────────────────────────
/**
 * Test whether a normalized command string matches a single permission pattern.
 *
 * @param {string} command - Normalized individual command (e.g. "git status")
 * @param {string} pattern - Raw permission pattern (e.g. "Bash(git:*)")
 * @returns {boolean}
 */
function commandMatchesPattern(command, pattern) {
  const parsed = parseBashPattern(pattern);
  if (!parsed) return false;

  if (parsed.type === 'any') return true;

  if (parsed.type === 'prefix') {
    // Match: command equals prefix OR command starts with "prefix "
    return command === parsed.prefix || command.startsWith(parsed.prefix + ' ');
  }

  if (parsed.type === 'glob') {
    return parsed.regex.test(command);
  }

  return false;
}

// ── loadMergedSettings ────────────────────────────────────────────────────────
/**
 * Read and merge permissions from all 4 settings layers:
 *   Layer 1: $CLAUDE_SETTINGS_PATH || ~/.claude/settings.json
 *   Layer 2: ~/.claude/settings.local.json
 *   Layer 3: $CLAUDE_PROJECT_DIR/.claude/settings.json
 *   Layer 4: $CLAUDE_PROJECT_DIR/.claude/settings.local.json
 *
 * Missing files and JSON parse errors are silently skipped.
 * allow/deny arrays are concatenated and deduplicated across layers.
 *
 * @param {object} [envOverride] - Override env vars (for testing). Defaults to process.env.
 * @returns {{ permissions: { allow: string[], deny: string[] } }}
 */
function loadMergedSettings(envOverride) {
  const env = envOverride || process.env;

  /**
   * @param {string} filePath
   * @returns {object} Parsed JSON or {} on failure
   */
  function loadSettings(filePath) {
    try {
      const content = fs.readFileSync(filePath, 'utf8');
      return JSON.parse(content);
    } catch (_e) {
      return {};
    }
  }

  const homeDir = env.HOME || os.homedir();

  // Layer 1: global settings ($CLAUDE_SETTINGS_PATH or ~/.claude/settings.json)
  const layer1Path = env.CLAUDE_SETTINGS_PATH || path.join(homeDir, '.claude', 'settings.json');
  const layer1 = loadSettings(layer1Path);

  // Layer 2: global local settings (~/.claude/settings.local.json)
  const layer2Path = path.join(homeDir, '.claude', 'settings.local.json');
  const layer2 = loadSettings(layer2Path);

  // Layers 3 & 4 require CLAUDE_PROJECT_DIR
  const projectDir = env.CLAUDE_PROJECT_DIR || '';
  const layer3 = projectDir
    ? loadSettings(path.join(projectDir, '.claude', 'settings.json'))
    : {};
  const layer4 = projectDir
    ? loadSettings(path.join(projectDir, '.claude', 'settings.local.json'))
    : {};

  // Merge all layers — concatenate and deduplicate
  function extractArray(obj, key) {
    const perms = obj && obj.permissions;
    const arr = perms && perms[key];
    return Array.isArray(arr) ? arr : [];
  }

  const allAllow = [
    ...extractArray(layer1, 'allow'),
    ...extractArray(layer2, 'allow'),
    ...extractArray(layer3, 'allow'),
    ...extractArray(layer4, 'allow'),
  ];
  const allDeny = [
    ...extractArray(layer1, 'deny'),
    ...extractArray(layer2, 'deny'),
    ...extractArray(layer3, 'deny'),
    ...extractArray(layer4, 'deny'),
  ];

  return {
    permissions: {
      allow: [...new Set(allAllow)],
      deny: [...new Set(allDeny)],
    },
  };
}

// ── decide ────────────────────────────────────────────────────────────────────
/**
 * Make an allow/deny/passthrough decision for a bash command.
 *
 * Algorithm:
 *   1. Decompose command into sub-commands
 *   2. For each sub-command: check deny patterns FIRST (deny-first)
 *   3. If any sub-command matches deny -> return {decision: 'deny', reason}
 *   4. For each sub-command: check allow patterns
 *   5. If ALL sub-commands matched allow -> return {decision: 'allow', reason}
 *   6. If ANY sub-command unmatched -> return {decision: 'passthrough'}
 *
 * @param {string} command - Raw bash command (may be compound)
 * @param {{ permissions: { allow: string[], deny: string[] } }} settings - Merged settings
 * @returns {{ decision: 'allow'|'deny'|'passthrough', reason?: string }}
 */
function decide(command, settings) {
  const allowPatterns = (settings && settings.permissions && settings.permissions.allow) || [];
  const denyPatterns = (settings && settings.permissions && settings.permissions.deny) || [];

  const subCommands = decomposeCommand(command);

  if (subCommands.length === 0) {
    // Nothing to check (empty or structural-only) — passthrough
    return { decision: 'passthrough' };
  }

  // ── Step 1: Deny-first check ─────────────────────────────────────────────
  for (const sub of subCommands) {
    for (const pattern of denyPatterns) {
      if (commandMatchesPattern(sub, pattern)) {
        return {
          decision: 'deny',
          reason: `Command "${sub}" matches deny pattern "${pattern}"`,
        };
      }
    }
  }

  // ── Step 2: Allow check — ALL sub-commands must match ───────────────────
  const matched = [];
  const unmatched = [];

  for (const sub of subCommands) {
    // Check allow patterns
    let found = false;
    for (const pattern of allowPatterns) {
      if (commandMatchesPattern(sub, pattern)) {
        matched.push({ sub, via: pattern });
        found = true;
        break;
      }
    }

    if (!found) {
      unmatched.push(sub);
    }
  }

  if (unmatched.length === 0 && matched.length > 0) {
    const reasons = matched.map(m =>
      `"${m.sub}" matches allow pattern "${m.via}"`
    );
    return {
      decision: 'allow',
      reason: reasons.join('; '),
    };
  }

  return { decision: 'passthrough' };
}

// ── Main hook body ────────────────────────────────────────────────────────────
// Guard execution with require.main === module — allows pure function testing
// without executing stdin reader.

if (require.main === module) {
  // ── Kill switch — exit immediately when disabled (must be inside require.main
  //    so that require()ing this module for testing doesn't exit the process) ──
  if (process.env.GSD_DISABLE_BASH_HOOK === '1') {
    process.exit(0);
  }

  const debug = process.env.GSD_HOOK_DEBUG === '1';

  let input = '';
  // Timeout guard: if stdin doesn't close within 3s, exit silently
  const stdinTimeout = setTimeout(() => process.exit(0), 3000);
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => { input += chunk; });
  process.stdin.on('end', () => {
    clearTimeout(stdinTimeout);
    try {
      const data = JSON.parse(input);

      // Only handle Bash tool calls
      if (data.tool_name !== 'Bash') {
        if (debug) process.stderr.write('[gsd-bash-hook] non-Bash tool, passthrough\n');
        process.exit(0);
      }

      const command = (data.tool_input && data.tool_input.command) || '';
      if (debug) process.stderr.write('[gsd-bash-hook] command: ' + command + '\n');

      const settings = loadMergedSettings();
      const result = decide(command, settings);

      if (debug) process.stderr.write('[gsd-bash-hook] decision: ' + result.decision + '\n');

      if (result.decision === 'allow') {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'allow',
            permissionDecisionReason: result.reason || 'All sub-commands approved',
          },
        }));
        process.exit(0);
      }

      if (result.decision === 'deny') {
        process.stdout.write(JSON.stringify({
          hookSpecificOutput: {
            hookEventName: 'PreToolUse',
            permissionDecision: 'deny',
            permissionDecisionReason: result.reason || 'Command denied by pattern',
          },
        }));
        process.exit(0);
      }

      // Passthrough — exit 0 silently, Claude Code prompts normally
      process.exit(0);
    } catch (_e) {
      // Graceful degradation — never block tool execution
      if (debug) process.stderr.write('[gsd-bash-hook] error: ' + _e.message + '\n');
      process.exit(0);
    }
  });
}

// ── Module exports for testability ───────────────────────────────────────────
module.exports = {
  isInsideQuotes,
  stripHeredocs,
  splitOnOperators,
  normalizeCommand,
  decomposeCommand,
  extractSubshells,
  parseBashPattern,
  commandMatchesPattern,
  loadMergedSettings,
  decide,
  HEREDOC_START_RE,
  _skipShellValue,
  isStandaloneAssignment,
};
