/**
 * GSD Tools Tests - guard.cjs
 *
 * Tests for the guard library — particularly the cmdGuardInitValid function
 * whose !jsonStr / !jsonStr.trim() error path is unreachable from the CLI
 * (validateArgs blocks empty positionals before dispatch). These tests use
 * direct invocation via spawnSync to exercise those branches.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');

const GUARD_LIB_PATH = path.resolve(
  '/home/chris/Development/gsd-workspace/gsd-ng/gsd-ng/bin/lib/guard.cjs',
);

describe('guard.cjs cmdGuardInitValid branches', () => {
  test('valid JSON object passes silently', () => {
    const code = `require(${JSON.stringify(GUARD_LIB_PATH)}).cmdGuardInitValid('{"phase":"01"}');`;
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.strictEqual(parsed.valid, true);
  });

  test('empty string triggers !jsonStr error path', () => {
    const code = `require(${JSON.stringify(GUARD_LIB_PATH)}).cmdGuardInitValid('');`;
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /empty or malformed/);
  });

  test('whitespace-only string triggers !jsonStr.trim() error path', () => {
    const code = `require(${JSON.stringify(GUARD_LIB_PATH)}).cmdGuardInitValid('   ');`;
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /empty or malformed/);
  });

  test('null/undefined triggers !jsonStr error path', () => {
    const code = `require(${JSON.stringify(GUARD_LIB_PATH)}).cmdGuardInitValid(null);`;
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /empty or malformed/);

    const code2 = `require(${JSON.stringify(GUARD_LIB_PATH)}).cmdGuardInitValid(undefined);`;
    const r2 = spawnSync(process.execPath, ['-e', code2], { encoding: 'utf-8' });
    assert.strictEqual(r2.status, 1);
    assert.match(r2.stderr, /empty or malformed/);
  });

  test('malformed JSON triggers JSON.parse catch', () => {
    const code = `require(${JSON.stringify(GUARD_LIB_PATH)}).cmdGuardInitValid('INVALID{');`;
    const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /empty or malformed/);
  });
});

describe('guard.cjs cmdGuardSyncChain export', () => {
  test('cmdGuardSyncChain is exported', () => {
    const guard = require(GUARD_LIB_PATH);
    assert.strictEqual(typeof guard.cmdGuardSyncChain, 'function');
  });
});
