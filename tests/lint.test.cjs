'use strict';
/**
 * Structural lint rules for the test suite and production code.
 *
 * These are not behavioural tests — they enforce code conventions that
 * prevent copy-paste drift and helper bypass. Each rule runs as a fast
 * file-scan; failures name the exact line so fixes are unambiguous.
 *
 * Adding a new rule here keeps it discoverable and keeps domain test files
 * (roadmap.test.cjs, guardrail.test.cjs, etc.) focused on behaviour.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// ── helpers ──────────────────────────────────────────────────────────────────

// Collect all *.test.cjs files except this one.
function testFiles() {
  const self = path.basename(__filename);
  return fs.readdirSync(__dirname)
    .filter(f => f.endsWith('.test.cjs') && f !== self)
    .map(f => ({ name: f, src: fs.readFileSync(path.join(__dirname, f), 'utf-8') }));
}

// ── Rule 1: no direct os.tmpdir() — use resolveTmpDir from helpers.cjs ───────

describe('lint: no os.tmpdir() in test files (use resolveTmpDir from helpers.cjs)', () => {
  test('no test file calls os.tmpdir() directly', () => {
    const violations = [];
    for (const { name, src } of testFiles()) {
      src.split('\n').forEach((line, i) => {
        if (line.includes('os.tmpdir()') && !line.trim().startsWith('//')) {
          violations.push(`${name}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepStrictEqual(violations, [],
      `Direct os.tmpdir() usage found (use resolveTmpDir() from helpers.cjs instead):\n${violations.join('\n')}`
    );
  });
});

// ── Rule 2: no inline redeclaration of helpers.cjs exports ───────────────────

describe('lint: no inline redeclaration of helpers.cjs exports in test files', () => {
  // Catches copy-paste of cleanup() or resolveTmpDir() instead of importing from helpers.cjs.
  // Note: local helpers that *use* these (e.g. makeTmpDir returning {tmpDir, cleanup}) are fine.
  // `exclude` rules out legitimate forms like `const cleanup = require(...)`.
  const forbidden = [
    { pattern: 'function cleanup(', hint: 'import cleanup from helpers.cjs' },
    { pattern: 'function resolveTmpDir(', hint: 'import resolveTmpDir from helpers.cjs' },
    { pattern: 'const cleanup = ', hint: 'import cleanup from helpers.cjs', exclude: 'require(' },
    { pattern: 'const resolveTmpDir = ', hint: 'import resolveTmpDir from helpers.cjs', exclude: 'require(' },
  ];

  for (const { pattern, hint, exclude } of forbidden) {
    test(`no test file declares \`${pattern.trim()}\` (${hint})`, () => {
      const violations = [];
      for (const { name, src } of testFiles()) {
        src.split('\n').forEach((line, i) => {
          if (
            line.includes(pattern) &&
            (!exclude || !line.includes(exclude)) &&
            !line.trim().startsWith('//')
          ) {
            violations.push(`${name}:${i + 1}: ${line.trim()}`);
          }
        });
      }
      assert.deepStrictEqual(violations, [],
        `Inline redeclaration of helper found:\n${violations.join('\n')}`
      );
    });
  }
});

// ── Rule 3: no bare recursive dir deletion — use cleanup/cleanupSubdir ────────

describe('lint: no bare recursive dir deletion in test files (use cleanup/cleanupSubdir from helpers.cjs)', () => {
  test('no test file calls fs.rmSync or fs.rmdirSync with recursive:true directly', () => {
    const violations = [];
    for (const { name, src } of testFiles()) {
      src.split('\n').forEach((line, i) => {
        if (
          (line.includes('fs.rmSync(') || line.includes('fs.rmdirSync(')) &&
          line.includes('recursive: true') &&
          !line.trim().startsWith('//')
        ) {
          violations.push(`${name}:${i + 1}: ${line.trim()}`);
        }
      });
    }
    assert.deepStrictEqual(violations, [],
      `Bare recursive dir deletion found (use cleanup() or cleanupSubdir() from helpers.cjs instead):\n${violations.join('\n')}`
    );
  });
});

// ── Rule 4: no bare roadmapContent.replace() in roadmap.cjs ──────────────────

describe('lint: no bare roadmapContent.replace() in roadmap.cjs', () => {
  test('no bare roadmapContent.replace() outside replaceInCurrentMilestone', () => {
    const roadmapSource = fs.readFileSync(
      path.join(__dirname, '..', 'gsd-ng', 'bin', 'lib', 'roadmap.cjs'), 'utf-8'
    );
    const violations = [];
    roadmapSource.split('\n').forEach((line, i) => {
      if (
        line.includes('roadmapContent.replace(') &&
        !line.includes('replaceInCurrentMilestone') &&
        !line.trim().startsWith('//')
      ) {
        violations.push(`roadmap.cjs:${i + 1}: ${line.trim()}`);
      }
    });
    assert.deepStrictEqual(violations, [],
      `Bare roadmapContent.replace() found (use replaceInCurrentMilestone instead):\n${violations.join('\n')}`
    );
  });
});
