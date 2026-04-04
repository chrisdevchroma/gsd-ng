/**
 * GSD Tools Tests - Breakout Detection
 *
 * Tests for detectBreakout and cmdBreakoutCheck functions.
 * These detect when executor agents modify files outside their declared plan scope
 * (files_modified frontmatter) to enforce workflow boundary adherence.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempGitProject, cleanup } = require('./helpers.cjs');

// Direct require for unit testing internal helpers
const commands = require('../gsd-ng/bin/lib/commands.cjs');

// ─── Unit tests for detectBreakout ───────────────────────────────────────────

describe('detectBreakout', () => {
  test('Test 1: returns ok when all committed files are in declaredFiles list', () => {
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat(18-01): add feature', files: ['src/a.js', 'src/b.js'] },
    ];
    const declaredFiles = ['src/a.js', 'src/b.js'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'ok');
    assert.deepStrictEqual(result.details.unexpected_files, []);
  });

  test('Test 2: returns ok when declaredFiles is empty (skip check)', () => {
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat(18-01): add feature', files: ['src/a.js', 'src/b.js'] },
    ];
    const result = commands.detectBreakout(commits, []);
    assert.strictEqual(result.status, 'ok');
    assert.ok(result.reason.includes('No declared files'), `Expected 'No declared files' in reason, got: ${result.reason}`);
  });

  test('Test 3: returns ok when no commits provided', () => {
    const result = commands.detectBreakout([], ['src/a.js']);
    assert.strictEqual(result.status, 'ok');
    assert.ok(result.reason.includes('No commits'), `Expected 'No commits' in reason, got: ${result.reason}`);
  });

  test('Test 4: returns ok (informational tier) when 1 unexpected file is in same directory as a declared file', () => {
    // src/a.js is declared; src/c.js is unexpected but in same directory (src/)
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat(18-01): add feature', files: ['src/a.js', 'src/c.js'] },
    ];
    const declaredFiles = ['src/a.js'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'ok', `Expected ok (informational) for same-dir file, got: ${JSON.stringify(result)}`);
  });

  test('Test 5: returns warning when 1-3 unexpected files are in different directories from declared files', () => {
    // Declared: src/a.js; committed: src/a.js + lib/utils.js (different dir)
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat(18-01): add feature', files: ['src/a.js', 'lib/utils.js'] },
    ];
    const declaredFiles = ['src/a.js'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'warning', `Expected warning for cross-dir unexpected file, got: ${JSON.stringify(result)}`);
    assert.ok(result.details.unexpected_files.length > 0, 'Should have unexpected files in details');
  });

  test('Test 6: returns halt when 4+ unexpected files are in different directories from declared files', () => {
    // Declared: src/a.js; committed 4+ files in different directories
    const commits = [
      {
        hash: 'a1',
        author: 'executor@gsd',
        subject: 'feat(18-01): add feature',
        files: ['src/a.js', 'lib/utils.js', 'config/settings.js', 'db/schema.js', 'api/routes.js'],
      },
    ];
    const declaredFiles = ['src/a.js'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'halt', `Expected halt for 4+ cross-dir unexpected files, got: ${JSON.stringify(result)}`);
  });

  test('Test 7: detectBreakout ignores .planning/ paths (always allowed)', () => {
    const commits = [
      {
        hash: 'a1',
        author: 'executor@gsd',
        subject: 'feat(18-01): add feature',
        files: ['src/a.js', '.planning/STATE.md', '.planning/phases/18-01-SUMMARY.md'],
      },
    ];
    const declaredFiles = ['src/a.js'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'ok', `.planning/ files should be always-allowed, got: ${JSON.stringify(result)}`);
  });

  test('Test 8: detectBreakout ignores .claude/ paths (always allowed)', () => {
    const commits = [
      {
        hash: 'a1',
        author: 'executor@gsd',
        subject: 'feat(18-01): add feature',
        files: ['src/a.js', '.claude/settings.json', '.claude/hooks/gsd-guardrail.js'],
      },
    ];
    const declaredFiles = ['src/a.js'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'ok', `.claude/ files should be always-allowed, got: ${JSON.stringify(result)}`);
  });

  test('Test 9: detectBreakout ignores package-lock.json (always allowed)', () => {
    const commits = [
      {
        hash: 'a1',
        author: 'executor@gsd',
        subject: 'feat(18-01): add feature',
        files: ['src/a.js', 'package-lock.json'],
      },
    ];
    const declaredFiles = ['src/a.js'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'ok', `package-lock.json should be always-allowed, got: ${JSON.stringify(result)}`);
  });

  test('Test 10: treats test file paired with declared implementation file as informational', () => {
    // Declared: src/commands.cjs; test file tests/commands.test.cjs should be informational
    const commits = [
      {
        hash: 'a1',
        author: 'executor@gsd',
        subject: 'feat(18-01): add feature',
        files: ['src/commands.cjs', 'tests/commands.test.cjs'],
      },
    ];
    const declaredFiles = ['src/commands.cjs'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'ok', `Paired test file should be informational (ok), got: ${JSON.stringify(result)}`);
  });

  test('Test 11: normalizes paths (strips leading ./ before comparison)', () => {
    // ./src/a.js in committed files should match src/a.js in declared files
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat(18-01): add feature', files: ['./src/a.js', './src/b.js'] },
    ];
    const declaredFiles = ['src/a.js', 'src/b.js'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'ok', `Path normalization should match ./src/a.js to src/a.js, got: ${JSON.stringify(result)}`);
  });

  test('Test 13: treats file in sibling directory (same leaf name) as informational', () => {
    // src/engine/ declared, include/engine/ has unexpected file — same leaf 'engine'
    const commits = [
      {
        hash: 'a1',
        author: 'executor@gsd',
        subject: 'feat(22-03): add physics',
        files: ['src/engine/physics.cpp', 'include/engine/collision.h'],
      },
    ];
    const declaredFiles = ['src/engine/physics.cpp'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'ok',
      `Sibling dir file (include/engine/) should be informational, got: ${JSON.stringify(result)}`);
    // Verify the unexpected file is classified as info, not warning
    const unexpected = result.details.unexpected_files;
    assert.ok(unexpected.length > 0, 'Should have unexpected files');
    assert.ok(unexpected.every(u => u.tier === 'info'),
      `All unexpected files should be info tier, got: ${JSON.stringify(unexpected)}`);
  });

  test('Test 14: treats file in non-sibling directory (different leaf) as warning', () => {
    // src/engine/ declared, include/other/ has unexpected file — leaf 'other' != 'engine'
    const commits = [
      {
        hash: 'a1',
        author: 'executor@gsd',
        subject: 'feat(22-03): add physics',
        files: ['src/engine/physics.cpp', 'include/other/collision.h'],
      },
    ];
    const declaredFiles = ['src/engine/physics.cpp'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'warning',
      `Non-sibling dir file should trigger warning, got: ${JSON.stringify(result)}`);
  });

  test('Test 15: root-level files do not trigger sibling heuristic', () => {
    // Both files at root level — dirname is '.', guard must prevent false match
    // But inDeclaredDir should still classify as info since both are in same dir '.'
    const commits = [
      {
        hash: 'a1',
        author: 'executor@gsd',
        subject: 'feat(22-03): update docs',
        files: ['README.md', 'CHANGELOG.md'],
      },
    ];
    const declaredFiles = ['README.md'];
    const result = commands.detectBreakout(commits, declaredFiles);
    // inDeclaredDir handles this — both are in root dir '.'
    assert.strictEqual(result.status, 'ok',
      `Root-level same-dir file should be ok (informational), got: ${JSON.stringify(result)}`);
  });

  test('Test 16: sibling heuristic coexists with test-pair heuristic', () => {
    // Declared: lib/core/parser.js; Committed: tests/core/parser.test.js
    // This matches both test-pair (stem 'parser') and sibling (leaf 'core')
    const commits = [
      {
        hash: 'a1',
        author: 'executor@gsd',
        subject: 'feat(22-03): add parser',
        files: ['lib/core/parser.js', 'tests/core/parser.test.js'],
      },
    ];
    const declaredFiles = ['lib/core/parser.js'];
    const result = commands.detectBreakout(commits, declaredFiles);
    assert.strictEqual(result.status, 'ok',
      `File matching both test-pair and sibling should be info, got: ${JSON.stringify(result)}`);
  });
});

// ─── Integration test for cmdBreakoutCheck ────────────────────────────────────

describe('cmdBreakoutCheck integration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('Test 12: cmdBreakoutCheck via gsd-tools breakout-check --plan 18-01 --declared-files src/a.js,src/b.js returns JSON with status field', () => {
    // Write files and commit with plan-tagged message
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'content a');
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'content b');
    execSync('git add -A && git commit -m "feat(18-01): implement feature"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runGsdTools(
      ['breakout-check', '--plan', '18-01', '--declared-files', 'src/a.js,src/b.js', '--json'],
      tmpDir
    );

    assert.ok(result.success, `Command failed: ${result.error}`);

    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(result.output);
    }, `Output must be valid JSON. Got: ${result.output}`);

    assert.ok(parsed.status, 'Result must have status field');
    assert.ok(['ok', 'warning', 'halt'].includes(parsed.status), `Status must be ok/warning/halt, got: ${parsed.status}`);

    // Since both files are declared, result should be ok
    assert.strictEqual(parsed.status, 'ok', `Expected ok when all committed files are declared, got: ${JSON.stringify(parsed)}`);
  });
});
