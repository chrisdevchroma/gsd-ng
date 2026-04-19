'use strict';

// Lint for grep patterns embedded in documentation / reference / agent files.
//
// Three detection classes:
//
//   1. PCRE-only escapes (`\s`/`\S`/`\b`/`\B`/`\w`/`\W`/`\d`/`\D`) in
//      `grep -E` patterns. These fail silently on BSD grep and emit
//      "stray \" warnings on GNU grep. Use POSIX bracket classes
//      (`[[:space:]]`, `[[:alnum:]_]`, `[[:digit:]]`).
//
//   2. Chained grep pipelines where stage 1 adds a per-line prefix
//      (`-n` line number, `-H`/`-r` filename, or multi-file auto-prefix)
//      and stage 2 anchors with `^`. The anchor can never line up
//      against the prefix, so the pipeline matches nothing.
//
//   3. Grouped alternation `(a|b)` inside `grep -E`. gsd-ng workflows
//      run under Claude Code whose tree-sitter walker crashes on this
//      syntax (upstream claude-code#42085/#43713/#48717); use flat
//      alternation.
//
// Structure: synthetic-input self-tests prove the detectors catch what
// they claim to; real-doc tests assert zero violations across the
// linted file set. A regression in a detector would silently let real
// bugs through, so the self-tests are load-bearing.

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

// Count likely file-path arguments to a single grep command. Best-effort:
// tokenizes the command line, strips flags (handling short flags that
// consume a value: -e, -f, -A, -B, -C), treats the first remaining
// non-flag as the pattern, and counts the rest as path args.
// Returns 0 if the command doesn't start with `grep`.
function countFileArgsInGrep(grepCmd) {
  const m = /^\s*grep\b(.*)$/.exec(grepCmd);
  if (!m) return 0;
  const rest = m[1];
  const tokens = [];
  let current = '';
  let quote = null;
  for (let i = 0; i < rest.length; i++) {
    const ch = rest[i];
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/.test(ch)) {
      if (current) { tokens.push(current); current = ''; }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);

  const nonFlags = [];
  let patternProvidedByFlag = false;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.startsWith('--')) {
      // --regexp=PAT / --file=PAT provide the pattern; --regexp / --file
      // followed by a separate arg also consume it.
      if (/^--(regexp|file)=/.test(t)) patternProvidedByFlag = true;
      else if (/^--(regexp|file)$/.test(t)) { patternProvidedByFlag = true; i++; }
      continue;
    }
    if (t.startsWith('-') && t.length > 1) {
      const last = t[t.length - 1];
      if (last === 'e' || last === 'f') { patternProvidedByFlag = true; i++; }
      else if (last === 'A' || last === 'B' || last === 'C') { i++; }
      continue;
    }
    nonFlags.push(t);
  }
  // If the pattern came from -e/-f, all positional non-flags are paths.
  // Otherwise, the first non-flag is the pattern and the rest are paths.
  return patternProvidedByFlag ? nonFlags.length : Math.max(0, nonFlags.length - 1);
}

// Detect chained grep pipelines where stage 1 adds a per-line prefix and
// stage 2 anchors with `^` in a way that can't match the prefix.
//
// Stage 1 adds a prefix via:
//   * -n (line-number prefix: `N:` for matches, `N-` for context lines)
//   * -H (force-filename prefix: `FILENAME:`)
//   * -r / -R (recursive — adds `FILENAME:` prefix)
//   * multi-file invocation (≥2 path args auto-add `FILENAME:`) unless
//     suppressed by -h
//
// Stage 2 is considered safe if its `^`-anchored pattern EXPLICITLY
// consumes the prefix (e.g. `^[[:digit:]]+[-:]...` for -n output). Only
// non-prefix-aware anchors count as traps.
function findChainedPrefixTrap(line) {
  const pipeIdx = line.indexOf('|');
  if (pipeIdx === -1) return null;
  const left = line.slice(0, pipeIdx);
  const right = line.slice(pipeIdx + 1);

  // Identify stage 1 as the LAST command on the left side (the one that
  // actually pipes into stage 2). Anything like `echo grep ... | grep '^x'`
  // should NOT trigger the detector — the `echo` doesn't produce grep's
  // output format.
  const leftSegments = left.split(/(?:&&|\|\||;)/);
  const stage1 = leftSegments[leftSegments.length - 1].trim();
  if (!/^grep\b/.test(stage1)) return null;
  if (!/\bgrep\b/.test(right)) return null;

  // Extract the portion of stage-2's regex after the first `^` anchor.
  const anchoredMatch = /\bgrep\b[^'"]*['"]([^'"]*?)\^([^'"]*)['"]/.exec(right);
  if (!anchoredMatch) return null;
  const afterCaret = anchoredMatch[2];

  // Prefix-aware stage-2 anchors are safe: they consume the prefix
  // (filename + `:`/`-` separator, or line-number + `:`/`-`) explicitly
  // before matching the intended content. The exemption requires BOTH
  // a matching class with `+`/`*` quantifier AND a separator match
  // immediately after — `^[^:]+const` without the `:` consume is NOT
  // prefix-aware and remains a trap (the anchor can never line up).
  if (/^\[\[:digit:\]\][*+][\[\-:]/.test(afterCaret)) return null;
  if (/^\[0-9\][*+][\[\-:]/.test(afterCaret)) return null;
  if (/^\[\^[^\]]*\][*+][\[\-:]/.test(afterCaret)) return null;

  const flagHasN = /\s-[A-Za-z]*n[A-Za-z]*(\s|$)/.test(stage1);
  const flagHasH = /\s-[A-Za-z]*H[A-Za-z]*(\s|$)/.test(stage1);
  const flagHasR = /\s-[A-Za-z]*[rR][A-Za-z]*(\s|$)/.test(stage1);
  const flagHasLowerH = /\s-[A-Za-z]*h[A-Za-z]*(\s|$)/.test(stage1) && !flagHasH;

  if (flagHasN) return "stage 1 uses -n (line-number prefix); stage 2 anchors with ^ and does not consume the prefix";
  if (flagHasH) return "stage 1 uses -H (filename prefix); stage 2 anchors with ^ and does not consume the prefix";
  if (flagHasR && !flagHasLowerH) return "stage 1 uses -r (filename prefix); stage 2 anchors with ^ and does not consume the prefix";

  // Multi-file auto-prefix: ≥2 path args cause grep to prepend `FILENAME:`
  // unless -h is used.
  const paths = countFileArgsInGrep(stage1);
  if (paths >= 2 && !flagHasLowerH) {
    return "stage 1 has " + paths + " file args (multi-file auto-prefixes filename); stage 2 anchors with ^ and does not consume the prefix";
  }

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

  test('findChainedPrefixTrap ignores lines where stage 1 is not actually grep', () => {
    // `echo grep ...` is an echo command, not a grep. The word "grep"
    // appears in the output but the command doesn't produce grep's
    // output format, so no prefix trap exists.
    assert.equal(findChainedPrefixTrap('echo grep foo | grep -E "^x"'), null);
    assert.equal(findChainedPrefixTrap('printf "grep -n bar" | grep -E "^y"'), null);
    // But a `cd foo && grep -n bar | grep -E "^x"` IS a real trap — grep
    // is the last command before the pipe.
    assert.ok(findChainedPrefixTrap('cd foo && grep -n "bar" f | grep -E "^x"'));
  });

  test('findChainedPrefixTrap catches multi-file auto-prefix', () => {
    // ≥2 path args cause grep to prepend `FILENAME:` unless -h is used.
    assert.ok(findChainedPrefixTrap('grep -E "^VAR=" .env .env.local | grep -E "^VAR=value"'));
    assert.ok(findChainedPrefixTrap('grep "foo" a.txt b.txt c.txt | grep -E "^bar"'));
  });

  test('findChainedPrefixTrap ignores multi-file when -h suppresses filename', () => {
    assert.equal(findChainedPrefixTrap('grep -h "foo" a.txt b.txt | grep -E "^bar"'), null);
  });

  test('findChainedPrefixTrap ignores prefix-aware stage 2 anchors', () => {
    // Stage 2 that explicitly consumes the prefix is safe.
    assert.equal(findChainedPrefixTrap('grep -n "foo" f | grep -E "^[[:digit:]]+[-:][[:space:]]*const"'), null);
    assert.equal(findChainedPrefixTrap('grep -n -B 2 "foo" f | grep -E "^[0-9]+[-:]const"'), null);
    assert.equal(findChainedPrefixTrap('grep -r "foo" src/ | grep -E "^[^:]+:[[:space:]]*const"'), null);
  });

  test('findChainedPrefixTrap still flags incomplete prefix-consume patterns', () => {
    // `^[^:]+const` does NOT consume the `:` separator — for `-r` output
    // like `file.js:  const`, `[^:]+` matches up to the colon, and then
    // the next required literal `c` fails against the actual `:`. The
    // pattern therefore can never match; it's a trap, not a prefix-aware
    // anchor. This was a false-negative in the previous exemption regex.
    assert.ok(findChainedPrefixTrap('grep -r "foo" src/ | grep -E "^[^:]+const"'));
    assert.ok(findChainedPrefixTrap('grep -n "foo" f | grep -E "^[[:digit:]]+const"'));
    assert.ok(findChainedPrefixTrap('grep -n "foo" f | grep -E "^[0-9]+const"'));
  });

  test('countFileArgsInGrep tokenizes common forms', () => {
    assert.equal(countFileArgsInGrep('grep "pat" file1'), 1);
    assert.equal(countFileArgsInGrep('grep -E "pat" file1 file2'), 2);
    assert.equal(countFileArgsInGrep('grep -n -B 2 -A 2 "pat" file1 file2 file3'), 3);
    // -e takes a value (the pattern), so remaining positional is paths only.
    assert.equal(countFileArgsInGrep('grep -e "pat" file1 file2'), 2);
    // Bare flag bundle.
    assert.equal(countFileArgsInGrep('grep -inr "pat" src/'), 1);
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
  countFileArgsInGrep,
  lintContent,
};
