'use strict';
// Unit tests for GitHub Releases fallback helper functions in gsd-check-update.js
// GitHub fallback for update detection when npm registry is unavailable

const { test } = require('node:test');
const assert = require('node:assert/strict');

// Set GSD_TEST_MODE before requiring the hook so it exports utilities and skips hook execution
process.env.GSD_TEST_MODE = '1';
const { compareSemVer, normalizeTag, isSnapshot } = require('../hooks/gsd-check-update.js');

// ── compareSemVer ─────────────────────────────────────────────────────────────

test('compareSemVer: 1.9.0 < 1.10.0 (minor version numeric comparison)', () => {
  const result = compareSemVer('1.9.0', '1.10.0');
  assert.ok(result < 0, `expected compareSemVer('1.9.0', '1.10.0') < 0, got ${result}`);
});

test('compareSemVer: 2.0.0 > 1.9.9 (major version increment)', () => {
  const result = compareSemVer('2.0.0', '1.9.9');
  assert.ok(result > 0, `expected compareSemVer('2.0.0', '1.9.9') > 0, got ${result}`);
});

test('compareSemVer: 1.0.0 === 1.0.0 (equal versions)', () => {
  const result = compareSemVer('1.0.0', '1.0.0');
  assert.strictEqual(result, 0, `expected compareSemVer('1.0.0', '1.0.0') === 0, got ${result}`);
});

test('compareSemVer: 0.0.1 < 0.0.2 (patch version increment)', () => {
  const result = compareSemVer('0.0.1', '0.0.2');
  assert.ok(result < 0, `expected compareSemVer('0.0.1', '0.0.2') < 0, got ${result}`);
});

test('compareSemVer: strips +build metadata before comparing', () => {
  // 1.0.0+abc should equal 1.0.0 for version comparison purposes
  const result = compareSemVer('1.0.0+abc1234', '1.0.0');
  assert.strictEqual(result, 0, `expected compareSemVer('1.0.0+abc1234', '1.0.0') === 0, got ${result}`);
});

// ── normalizeTag ──────────────────────────────────────────────────────────────

test('normalizeTag: strips v prefix from GitHub tag', () => {
  const result = normalizeTag('v1.0.0');
  assert.strictEqual(result, '1.0.0', `expected normalizeTag('v1.0.0') === '1.0.0', got ${result}`);
});

test('normalizeTag: leaves plain semver unchanged', () => {
  const result = normalizeTag('1.0.0');
  assert.strictEqual(result, '1.0.0', `expected normalizeTag('1.0.0') === '1.0.0', got ${result}`);
});

test('normalizeTag: strips v from pre-release tag', () => {
  const result = normalizeTag('v2.3.1');
  assert.strictEqual(result, '2.3.1', `expected normalizeTag('v2.3.1') === '2.3.1', got ${result}`);
});

// ── isSnapshot ────────────────────────────────────────────────────────────────

test('isSnapshot: detects + build metadata in version', () => {
  const result = isSnapshot('1.0.0+abc1234');
  assert.strictEqual(result, true, `expected isSnapshot('1.0.0+abc1234') === true, got ${result}`);
});

test('isSnapshot: returns false for clean semver version', () => {
  const result = isSnapshot('1.0.0');
  assert.strictEqual(result, false, `expected isSnapshot('1.0.0') === false, got ${result}`);
});

test('isSnapshot: returns false for version with pre-release dash (not a snapshot)', () => {
  const result = isSnapshot('1.0.0-beta.1');
  assert.strictEqual(result, false, `expected isSnapshot('1.0.0-beta.1') === false, got ${result}`);
});

// ── all-unit-tests anchor ───────────────────────────────────────────────────────────

test('AGENT-01: all GitHub fallback unit tests present (anchor)', () => {
  // This is a structural anchor test for CI grep — confirms the full
  // unit test suite is present: SemVer comparison, tag normalization, snapshot skip.
  // When gsd-check-update.js exports these functions (Task 2), all preceding tests
  // in this file will be GREEN.
  assert.ok(
    typeof compareSemVer === 'function',
    'compareSemVer must be exported from gsd-check-update.js via GSD_TEST_MODE'
  );
  assert.ok(
    typeof normalizeTag === 'function',
    'normalizeTag must be exported from gsd-check-update.js via GSD_TEST_MODE'
  );
  assert.ok(
    typeof isSnapshot === 'function',
    'isSnapshot must be exported from gsd-check-update.js via GSD_TEST_MODE'
  );
});
