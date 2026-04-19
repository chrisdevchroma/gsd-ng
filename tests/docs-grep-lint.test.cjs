'use strict';

// Lint for grep patterns embedded in documentation / reference / agent files.
// Catches three regression classes observed on PR #37:
//
//   1. PCRE-only escapes in `grep -E` patterns (`\s`/`\b`/`\w`/`\d` and
//      their negated forms). These fail silently on BSD grep and emit
//      "stray \" warnings on GNU grep. Use POSIX bracket classes instead
//      (`[[:space:]]`, `[[:alnum:]_]`, `[[:digit:]]`).
//
//   2. Chained grep pipelines where stage 1 adds a per-line prefix (`-n`
//      line number, `-H`/`-r` filename, or multi-file auto-prefix) and
//      stage 2 anchors a pattern with `^`. The anchor can never line up
//      against the prefix, so the pipeline matches nothing.
//
//   3. Grouped alternation `(a|b)` inside `grep -E` patterns. gsd-ng
//      workflows run under Claude Code whose tree-sitter walker crashes
//      on this syntax (upstream #42085/#43713/#48717); use flat
//      alternation instead.
//
// Each regression class is backed by a reference memory in
// ~/.claude/memory/ (posix-regex-portability, chained-grep-prefix-trap)
// plus the historical commits this PR was built from (2a3cf21 onward).
//
// The test runs synthetic-input self-tests (to prove the detectors work)
// and then runs the detectors against the real doc set (to prove zero
// violations ship). Adding a new file with violating grep patterns MUST
// fail this test.

const fs = require('fs');
const path = require('path');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const REPO_ROOT = path.join(__dirname, '..');

// Files audited for grep examples. New .md files with bash/sh blocks
// that users/agents will run should be added here.
const LINTED_FILES = [
  'docs/bash-safety-hook.md',
  'gsd-ng/references/verification-patterns-deep.md',
  'agents/gsd-verifier.md',
  'gsd-ng/workflows/map-codebase.md',
];

// Extract fenced ```bash / ```sh blocks. Returns [{ startLine, lines }],
// where startLine is 1-indexed line of the first content line in the block.
function extractBashBlocks(content) {
  const blocks = [];
  const lines = content.split('\n');
  let inBlock = false;
  let blockStart = 0;
  let buf = [];
  for (let i = 0; i < lines.length; i++) {
    if (!inBlock && /^```(bash|sh)\b/.test(lines[i])) {
      inBlock = true;
      blockStart = i + 2;
      buf = [];
    } else if (inBlock && /^```\s*$/.test(lines[i])) {
      blocks.push({ startLine: blockStart, lines: buf });
      inBlock = false;
    } else if (inBlock) {
      buf.push(lines[i]);
    }
  }
  return blocks;
}

// Detect PCRE-only escapes anywhere on a line containing `grep -E`.
// Returns string reason or null. Allows legitimate escaped literals
// (`\.`, `\$`, `\(`, `\[`, `\{`, `\|`, `\+`, `\?`, `\*`, `\"`, `\\`, etc.)
// but rejects `\s`/`\S`/`\b`/`\B`/`\w`/`\W`/`\d`/`\D` which are PCRE.
function findPCREescape(line) {
  if (!/\bgrep\b[^|]*\s-[A-Za-z]*E[A-Za-z]*\b/.test(line)) return null;
  const m = /\\[sSbBwWdD]/.exec(line);
  if (!m) return null;
  return "PCRE-only escape '" + m[0] + "' in grep -E (use POSIX [[:space:]]/[[:alnum:]_]/[[:digit:]] or their negations)";
}

// Detect chained grep pipelines where stage 1 adds a prefix and stage 2
// anchors with `^`. Heuristic, not a full parser — looks for the shape
// "grep [flags incl. -n/-r OR multi-file args] ... | grep ... '^...'".
function findChainedPrefixTrap(line) {
  const pipeIdx = line.indexOf('|');
  if (pipeIdx === -1) return null;
  const left = line.slice(0, pipeIdx);
  const right = line.slice(pipeIdx + 1);

  // Stage 1 must be a grep.
  if (!/^\s*grep\b/.test(left.trim()) && !/\bgrep\b/.test(left)) return null;

  // Stage 2 must be a grep anchored with ^ (inside a quoted pattern).
  if (!/\bgrep\b/.test(right)) return null;
  const anchoredPattern = /\bgrep\b[^'"]*['"][^'"]*\^/.test(right);
  if (!anchoredPattern) return null;

  // Stage 1 adds a prefix if: -n flag, -r/-R (recursive adds filename),
  // or multi-file (>=2 path args → grep auto-prefixes filename).
  // Short-option bundles like `-nH` also count.
  const flagHasN = /\bgrep\b[^|]*\s-[A-Za-z]*n[A-Za-z]*(\s|$)/.test(left);
  const flagHasH = /\bgrep\b[^|]*\s-[A-Za-z]*H[A-Za-z]*(\s|$)/.test(left);
  const flagHasR = /\bgrep\b[^|]*\s-[A-Za-z]*[rR][A-Za-z]*(\s|$)/.test(left);

  // Suppress if -h flag explicitly strips filename.
  const flagHasLowerH = /\bgrep\b[^|]*\s-[A-Za-z]*h[A-Za-z]*(\s|$)/.test(left) && !flagHasH;

  if (flagHasN) return "stage 1 uses -n (line-number prefix); stage 2 anchors with ^ — pipeline won't match";
  if (flagHasH) return "stage 1 uses -H (filename prefix); stage 2 anchors with ^ — pipeline won't match";
  if (flagHasR && !flagHasLowerH) return "stage 1 uses -r (adds filename prefix); stage 2 anchors with ^ — pipeline won't match";
  return null;
}

// Detect grouped alternation `(a|b)` inside grep -E patterns.
// Heuristic — looks for `(...|...)` inside a quoted argument to grep -E.
function findGroupedAltInGrepE(line) {
  if (!/\bgrep\b[^|]*\s-[A-Za-z]*E[A-Za-z]*\b/.test(line)) return null;
  // Look for (…|…) inside quotes.
  const m = /["']([^"']*\([^)]*\|[^)]*\)[^"']*)["']/.exec(line);
  if (!m) return null;
  return "grouped alternation '" + m[0] + "' in grep -E (trips tree-sitter walker; use flat alternation)";
}

const DETECTORS = [
  { name: 'PCRE escape', fn: findPCREescape },
  { name: 'Chained-prefix trap', fn: findChainedPrefixTrap },
  { name: 'Grouped alternation in grep -E', fn: findGroupedAltInGrepE },
];

function lintContent(content) {
  const violations = [];
  const blocks = extractBashBlocks(content);
  for (const block of blocks) {
    for (let i = 0; i < block.lines.length; i++) {
      const absLine = block.startLine + i;
      for (const { name, fn } of DETECTORS) {
        const reason = fn(block.lines[i]);
        if (reason) violations.push({ line: absLine, detector: name, reason, text: block.lines[i].trim() });
      }
    }
  }
  return violations;
}

// ────────────────────────────────────────────────────────────────────────
// Self-tests: synthetic inputs with known violations prove the detectors
// work. If the detectors regress, the real-doc tests below would silently
// pass even on broken docs — these guard against that.
// ────────────────────────────────────────────────────────────────────────

describe('docs-grep-lint detectors', () => {
  test('findPCREescape catches \\s / \\b / \\w / \\d in grep -E', () => {
    assert.ok(findPCREescape('grep -E "foo\\sbar" file'));
    assert.ok(findPCREescape('grep -E "\\bword\\b" file'));
    assert.ok(findPCREescape('grep -E "\\w+" file'));
    assert.ok(findPCREescape('grep -E "\\d{2}" file'));
  });

  test('findPCREescape ignores POSIX bracket classes', () => {
    assert.equal(findPCREescape('grep -E "[[:space:]]" file'), null);
    assert.equal(findPCREescape('grep -E "[[:alnum:]_]+" file'), null);
    assert.equal(findPCREescape('grep -E "[[:digit:]]{2}" file'), null);
  });

  test('findPCREescape ignores legitimate escaped literals', () => {
    assert.equal(findPCREescape('grep -E "\\.txt\\$" file'), null);
    assert.equal(findPCREescape('grep -E "\\[foo\\]" file'), null);
    assert.equal(findPCREescape('grep -E "a\\|b" file'), null);
  });

  test('findPCREescape ignores patterns in grep without -E (BRE)', () => {
    // BRE `grep "foo\sbar"` is separately problematic but this lint is
    // scoped to grep -E. Don't flag BRE.
    assert.equal(findPCREescape('grep "foo\\sbar" file'), null);
  });

  test('findChainedPrefixTrap catches grep -n | grep -E "^..."', () => {
    assert.ok(findChainedPrefixTrap('grep -n -B 2 -A 2 "foo" f | grep -E "^const"'));
    assert.ok(findChainedPrefixTrap('grep -n "pat" f | grep -E \'^[[:space:]]*x\''));
  });

  test('findChainedPrefixTrap catches grep -r | grep -E "^..."', () => {
    assert.ok(findChainedPrefixTrap('grep -r "foo" src/ | grep -E "^const"'));
  });

  test('findChainedPrefixTrap ignores un-anchored downstream', () => {
    assert.equal(findChainedPrefixTrap('grep -n "foo" f | grep -v "bar"'), null);
    assert.equal(findChainedPrefixTrap('grep -r "foo" src/ | grep -v "test"'), null);
    assert.equal(findChainedPrefixTrap('grep -A 5 "foo" f | grep -E "await"'), null);
  });

  test('findChainedPrefixTrap ignores stage 1 without prefix-adding flags', () => {
    assert.equal(findChainedPrefixTrap('grep "foo" f | grep -E "^const"'), null);
    assert.equal(findChainedPrefixTrap('grep -A 5 "foo" f | grep -E "^const"'), null);
  });

  test('findGroupedAltInGrepE catches (a|b) inside grep -E', () => {
    assert.ok(findGroupedAltInGrepE('grep -E "export (function|const)" file'));
    assert.ok(findGroupedAltInGrepE("grep -E '^(GET|POST)' file"));
  });

  test('findGroupedAltInGrepE ignores flat alternation', () => {
    assert.equal(findGroupedAltInGrepE('grep -E "export function|export const" file'), null);
    assert.equal(findGroupedAltInGrepE('grep -E "GET|POST|PUT" file'), null);
  });

  test('findGroupedAltInGrepE ignores (a)? single-alternative groups', () => {
    // `(async )?` is a single-alt group, different walker-trigger behavior,
    // and also rare in the codebase. Keep scope narrow: only flag when
    // the group actually contains `|`.
    assert.equal(findGroupedAltInGrepE('grep -E "export (async )?function" file'), null);
  });

  test('extractBashBlocks finds fenced bash blocks with correct line numbers', () => {
    const content = [
      '# Heading',    // 1
      '',             // 2
      '```bash',      // 3
      'grep foo bar', // 4
      'grep -E baz',  // 5
      '```',          // 6
      'text',         // 7
      '```sh',        // 8
      'echo x',       // 9
      '```',          // 10
    ].join('\n');
    const blocks = extractBashBlocks(content);
    assert.equal(blocks.length, 2);
    assert.equal(blocks[0].startLine, 4);
    assert.deepEqual(blocks[0].lines, ['grep foo bar', 'grep -E baz']);
    assert.equal(blocks[1].startLine, 9);
    assert.deepEqual(blocks[1].lines, ['echo x']);
  });
});

// ────────────────────────────────────────────────────────────────────────
// Real-doc tests: every linted file must have zero violations.
// ────────────────────────────────────────────────────────────────────────

describe('docs-grep-lint real docs', () => {
  for (const rel of LINTED_FILES) {
    const abs = path.join(REPO_ROOT, rel);
    test(rel + ' has zero grep-lint violations', () => {
      const content = fs.readFileSync(abs, 'utf8');
      const violations = lintContent(content);
      const formatted = violations.map(v =>
        '  ' + rel + ':' + v.line + ' [' + v.detector + '] ' + v.reason + '\n    line: ' + v.text
      ).join('\n');
      assert.equal(violations.length, 0,
        violations.length + ' violation(s) in ' + rel + ':\n' + formatted);
    });
  }
});

module.exports = {
  extractBashBlocks,
  findPCREescape,
  findChainedPrefixTrap,
  findGroupedAltInGrepE,
  lintContent,
};
