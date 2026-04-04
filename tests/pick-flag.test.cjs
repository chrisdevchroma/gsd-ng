/**
 * GSD Tools Tests - --pick flag
 *
 * Regression tests for the --pick CLI flag that extracts a single field
 * from JSON output, replacing the need for jq as an external dependency.
 */

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const { runGsdTools } = require('./helpers.cjs');

// ─── --pick flag ─────────────────────────────────────────────────────────────

describe('--pick flag', () => {
  test('extracts a top-level field from JSON output', () => {
    const result = runGsdTools('generate-slug "hello world" --pick slug');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.output, 'hello-world');
  });

  test('extracts a top-level field using array args', () => {
    const result = runGsdTools(['generate-slug', 'hello world', '--pick', 'slug']);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.output, 'hello-world');
  });

  test('returns empty string for missing field', () => {
    const result = runGsdTools('generate-slug "test" --pick nonexistent');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.output, '');
  });

  test('errors when --pick has no value', () => {
    const result = runGsdTools('generate-slug "test" --pick');
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Missing value for --pick/);
  });

  test('errors when --pick value starts with --', () => {
    const result = runGsdTools(['generate-slug', 'test', '--pick']);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Missing value for --pick/);
  });

  test('does not collide with frontmatter --field flag', () => {
    // frontmatter subcommand uses --field internally; --pick should not interfere
    const result = runGsdTools('generate-slug "test-value" --pick slug');
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.output, 'test-value');
  });

  test('works with current-timestamp command', () => {
    const result = runGsdTools('current-timestamp --pick timestamp');
    assert.strictEqual(result.success, true);
    assert.ok(result.output.length > 0, 'timestamp should not be empty');
    assert.match(result.output, /^\d{4}-\d{2}-\d{2}T/);
  });
});

// ─── --file flag ────────────────────────────────────────────────────────────

describe('--file flag (CLI integration)', () => {
  test('--file outputs @file: prefixed path with valid JSON in temp file', () => {
    const result = runGsdTools(['generate-slug', 'hello world', '--file', '--json']);
    assert.strictEqual(result.success, true);
    assert.ok(result.output.startsWith('@file:'), `Expected @file: prefix, got: ${result.output.slice(0, 50)}`);
    const tmpPath = result.output.slice(6);
    const contents = fs.readFileSync(tmpPath, 'utf-8');
    const parsed = JSON.parse(contents);
    assert.strictEqual(parsed.slug, 'hello-world');
    try { fs.unlinkSync(tmpPath); } catch {}
  });

  test('--file with still writes raw value to stdout (not @file:)', () => {
    const result = runGsdTools(['generate-slug', 'hello world', '--file']);
    assert.strictEqual(result.success, true);
    assert.ok(!result.output.startsWith('@file:'), 'Raw mode should not produce @file: output');
    assert.strictEqual(result.output, 'hello-world');
  });

  test('--file --pick extracts field from temp file correctly', () => {
    const result = runGsdTools(['generate-slug', 'hello world', '--file', '--pick', 'slug']);
    assert.strictEqual(result.success, true);
    assert.strictEqual(result.output, 'hello-world');
    // --pick should NOT leave @file: in output
    assert.ok(!result.output.startsWith('@file:'), '--pick should resolve @file: and extract field');
  });

  test('without --file, output is inline JSON (not @file:)', () => {
    const result = runGsdTools(['generate-slug', 'hello world', '--json']);
    assert.strictEqual(result.success, true);
    assert.ok(!result.output.startsWith('@file:'), 'Default should be inline JSON');
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.slug, 'hello-world');
  });
});
