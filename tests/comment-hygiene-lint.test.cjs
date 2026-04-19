'use strict';

// Lint for comments and test/describe names that cite context belonging
// outside the code (pull-request numbers, review-round markers, incident
// history in test-name suffixes).
//
// Rationale (from project guidance): code comments describe invariants
// and subtle constraints. Task-local context belongs in commit messages
// and pull-request descriptions, where it's versioned alongside the
// change but doesn't rot as the codebase evolves. A future reader should
// understand WHAT the code guarantees from the comment, not HOW it got
// that way.
//
// Detection is narrow and high-precision by design. PR/round references
// are flagged only in comment text (not in test-name prose, which often
// legitimately describes test input data). Test-name parenthetical
// suffixes are inspected for regression / PR-number / post-X / pre-X
// markers — the specific shape that collects incident history.

const fs = require('fs');
const path = require('path');
const { test, describe } = require('node:test');
const assert = require('node:assert');

const REPO_ROOT = path.join(__dirname, '..');

// Directories scanned. All `.cjs` and `.js` files below these roots get
// linted (non-recursive for simplicity; expand if project layout grows).
const SCAN_DIRS = ['tests', 'hooks', 'bin', 'bin/lib', 'scripts'];

function listCodeFiles() {
  const out = [];
  for (const dir of SCAN_DIRS) {
    const abs = path.join(REPO_ROOT, dir);
    let entries;
    try { entries = fs.readdirSync(abs, { withFileTypes: true }); }
    catch { continue; }
    for (const e of entries) {
      if (!e.isFile()) continue;
      if (!/\.(cjs|js)$/.test(e.name)) continue;
      out.push(path.join(dir, e.name));
    }
  }
  return out;
}

// Extract the portion of a line that's "comment context" — text after
// `//` — and the portion inside test('...') / describe('...') quotes.
// Returns { comment, testName }, either may be null.
function commentContext(line) {
  const out = { comment: null, testName: null };
  const slashIdx = line.indexOf('//');
  if (slashIdx !== -1 && !isInsideString(line, slashIdx)) {
    out.comment = line.slice(slashIdx + 2);
  }
  const testMatch = /^\s*(?:test|describe|it)\s*\(\s*(['"`])((?:[^'"`\\]|\\.)*)\1/.exec(line);
  if (testMatch) out.testName = testMatch[2];
  return out;
}

// Rough check: is position `idx` inside a single/double-quote string?
// Not a full parser — looks at the substring before `idx` for unmatched
// quotes, ignoring escaped quotes. Good enough for the common cases.
function isInsideString(line, idx) {
  const before = line.slice(0, idx);
  let sq = 0, dq = 0, bt = 0;
  for (let i = 0; i < before.length; i++) {
    const c = before[i];
    if (c === '\\') { i++; continue; }
    if (c === "'" && dq === 0 && bt === 0) sq ^= 1;
    else if (c === '"' && sq === 0 && bt === 0) dq ^= 1;
    else if (c === '`' && sq === 0 && dq === 0) bt ^= 1;
  }
  return sq !== 0 || dq !== 0 || bt !== 0;
}

// Detector: PR / pull-request references in comments.
// Intentionally NOT checked against test names — test prose often
// describes input data that contains "pull request #N". PR refs in
// test-name parenthetical suffixes are caught by the incident-marker
// detector below.
function findPRReference(line) {
  const ctx = commentContext(line);
  if (!ctx.comment) return null;
  const m = /\b(?:PR|pull request)\s*#?\d+\b/i.exec(ctx.comment);
  if (m) return "PR reference '" + m[0] + "' — PR context belongs in commit messages / PR descriptions, not in code";
  return null;
}

// Detector: review-round references in comments.
// Same scoping rationale as findPRReference.
function findRoundReference(line) {
  const ctx = commentContext(line);
  if (!ctx.comment) return null;
  const m = /\b(?:round[- ]?\d+|review round)\b/i.exec(ctx.comment);
  if (m) return "Review-round reference '" + m[0] + "' — review history belongs in commit messages, not in code";
  return null;
}

// Detector: incident-history marker inside a parenthetical suffix of a
// test / describe name. Flags parentheticals containing a regression
// word, a numeric PR reference, or a post-X / pre-X state marker.
function findTestNameIncidentMarker(line) {
  const ctx = commentContext(line);
  if (!ctx.testName) return null;
  const parens = /\(([^)]+)\)/g;
  let m;
  while ((m = parens.exec(ctx.testName)) !== null) {
    const inside = m[1];
    if (/\bregression\b/i.test(inside)) {
      return "Test name contains '(" + inside + ")' — describe the behavior tested, not the incident that motivated the test";
    }
    if (/\bPR\s*#?\d+\b/i.test(inside)) {
      return "Test name contains '(" + inside + ")' — PR reference belongs in commit message, not test name";
    }
    if (/\b(?:post|pre)-[a-z][a-z0-9_-]*\b/i.test(inside)) {
      return "Test name contains '(" + inside + ")' — describe the current invariant, not its relation to a previous state";
    }
  }
  return null;
}

const DETECTORS = [
  { name: 'PR reference', fn: findPRReference },
  { name: 'Review-round reference', fn: findRoundReference },
  { name: 'Test-name incident marker', fn: findTestNameIncidentMarker },
];

function lintFile(abs) {
  const content = fs.readFileSync(abs, 'utf8');
  const lines = content.split('\n');
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    for (const { name, fn } of DETECTORS) {
      const reason = fn(lines[i]);
      if (reason) violations.push({ line: i + 1, detector: name, reason, text: lines[i].trim() });
    }
  }
  return violations;
}

// ────────────────────────────────────────────────────────────────────────
// Self-tests: detectors must catch synthetic violations.
// ────────────────────────────────────────────────────────────────────────

describe('comment-hygiene detectors', () => {
  test('findPRReference catches PR #N in comments', () => {
    assert.ok(findPRReference('  // fix for PR #37'));
    assert.ok(findPRReference('// added in pull request 12'));
    assert.ok(findPRReference('// regression from PR42'));
  });

  test('findPRReference ignores PR references inside test-name prose', () => {
    // Test names often describe input data that happens to contain the
    // literal phrase. Only the incident-marker detector flags PR refs
    // in test-name parenthetical suffixes.
    assert.equal(findPRReference("  test('parses PR from Merge pull request #5678', () => {});"), null);
  });

  test('findPRReference ignores PR references inside non-comment strings', () => {
    assert.equal(findPRReference('const url = "https://github.com/foo/bar/pull/123";'), null);
  });

  test('findPRReference ignores "PRimary" / "uPRead" false-positive prefixes', () => {
    assert.equal(findPRReference('// PRimary key'), null);
    assert.equal(findPRReference('// aPRopos the thing'), null);
  });

  test('findRoundReference catches round-N and review-round phrasings', () => {
    assert.ok(findRoundReference('// round-2 fix'));
    assert.ok(findRoundReference('// from review round 3'));
    assert.ok(findRoundReference('// updated in round 1'));
  });

  test('findRoundReference ignores non-review-round uses', () => {
    assert.equal(findRoundReference('// round to two decimals'), null);
    assert.equal(findRoundReference('// perform one round of hashing'), null);
  });

  test('findTestNameIncidentMarker detects regression / PR-number / post-X markers in parentheticals', () => {
    assert.ok(findTestNameIncidentMarker("  test('bypass (regression)', () => {});"));
    assert.ok(findTestNameIncidentMarker("  test('bypass (PR #37 regression)', () => {});"));
    assert.ok(findTestNameIncidentMarker("  test('bypass (post-reorder)', () => {});"));
    assert.ok(findTestNameIncidentMarker("  test('bypass (pre-fix)', () => {});"));
  });

  test('findTestNameIncidentMarker ignores legitimate parentheticals', () => {
    assert.equal(findTestNameIncidentMarker("  test('handles null (edge case)', () => {});"), null);
    assert.equal(findTestNameIncidentMarker("  test('foo (mirror of bar)', () => {});"), null);
    assert.equal(findTestNameIncidentMarker("  test('bypass (not auto-approved)', () => {});"), null);
  });

  test('findTestNameIncidentMarker does not trigger on regression outside parens', () => {
    // "regression" plainly in the test title (not in a parenthetical
    // suffix) is allowed — it describes what the test is protecting
    // against, not the incident.
    assert.equal(findTestNameIncidentMarker("  test('regression test for bypass', () => {});"), null);
  });

  test('isInsideString detects unclosed single/double quotes', () => {
    assert.equal(isInsideString('const x = "foo //', 17), true);
    assert.equal(isInsideString('const x = "foo"; //', 17), false);
    assert.equal(isInsideString("const x = 'bar //", 15), true);
  });

  test('commentContext extracts // tail and test() quoted name', () => {
    const c1 = commentContext("  // hello world");
    assert.equal(c1.comment, ' hello world');
    const c2 = commentContext("  test('my name', () => {});");
    assert.equal(c2.testName, 'my name');
    const c3 = commentContext("  describe('suite A', () => {});");
    assert.equal(c3.testName, 'suite A');
  });
});

// ────────────────────────────────────────────────────────────────────────
// Real-code tests: every scanned code file must have zero violations.
// ────────────────────────────────────────────────────────────────────────

describe('comment-hygiene real code', () => {
  const files = listCodeFiles();

  test('at least one file was scanned (sanity)', () => {
    assert.ok(files.length > 0, 'listCodeFiles() returned no files — scan directories may be misconfigured');
  });

  for (const rel of files) {
    test(rel + ' has zero comment-hygiene violations', () => {
      const violations = lintFile(path.join(REPO_ROOT, rel));
      const formatted = violations.map(v =>
        '  ' + rel + ':' + v.line + ' [' + v.detector + '] ' + v.reason + '\n    line: ' + v.text
      ).join('\n');
      assert.equal(violations.length, 0,
        violations.length + ' violation(s) in ' + rel + ':\n' + formatted);
    });
  }
});

module.exports = {
  commentContext,
  isInsideString,
  findPRReference,
  findRoundReference,
  findTestNameIncidentMarker,
  lintFile,
  listCodeFiles,
};
