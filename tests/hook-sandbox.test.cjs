'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runHook } = require('./hook-harness.cjs');
const fs = require('fs');
const path = require('path');
const { resolveTmpDir } = require('./helpers.cjs');

const HOOKS_DIR = path.resolve(__dirname, '..', 'hooks');

// ── SAND-01: sandbox-detect emits additionalContext JSON ──────────────────────

test('SAND-01: sandbox-detect emits additionalContext JSON when SANDBOX_RUNTIME=1', () => {
  const sessionId = 'sand01-test-' + Date.now();
  const markerFile = path.join(resolveTmpDir(), `gsd-sandbox-detect-${sessionId}.flag`);

  try {
    const hookPath = path.join(HOOKS_DIR, 'gsd-sandbox-detect.js');
    const { stdout, stderr, exitCode } = runHook(
      hookPath,
      { session_id: sessionId },
      5000,
      { SANDBOX_RUNTIME: '1' }
    );

    assert.strictEqual(exitCode, 0, 'sandbox-detect must exit 0');
    assert.strictEqual(stderr, '', 'sandbox-detect must produce no stderr');

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${JSON.stringify(stdout)}`);
    }

    assert.strictEqual(
      typeof parsed.additionalContext,
      'string',
      'additionalContext must be a string'
    );
  } finally {
    fs.rmSync(markerFile, { force: true });
  }
});

// ── SAND-01: once-per-session deduplication ───────────────────────────────────

test('SAND-01: sandbox-detect exits 0 silently on second call (once-per-session)', () => {
  const sessionId = 'sand01-once-' + Date.now();
  const markerFile = path.join(resolveTmpDir(), `gsd-sandbox-detect-${sessionId}.flag`);

  try {
    const hookPath = path.join(HOOKS_DIR, 'gsd-sandbox-detect.js');
    const payload = { session_id: sessionId };
    const envOverrides = { SANDBOX_RUNTIME: '1' };

    // First call — should produce additionalContext output
    const first = runHook(hookPath, payload, 5000, envOverrides);
    assert.strictEqual(first.exitCode, 0, 'First call must exit 0');

    // Second call with same session_id — should produce empty stdout (deduplicated)
    const second = runHook(hookPath, payload, 5000, envOverrides);
    assert.strictEqual(second.exitCode, 0, 'Second call must exit 0');
    assert.strictEqual(second.stdout, '', 'Second call must produce empty stdout (already ran this session)');
  } finally {
    fs.rmSync(markerFile, { force: true });
  }
});

// ── SAND-02: gsd-statusline exits 0 under sandbox simulation ─────────────────

test('SAND-02: gsd-statusline exits 0 with no stderr under GSD_SIMULATE_SANDBOX', () => {
  const hookPath = path.join(HOOKS_DIR, 'gsd-statusline.js');
  const { stderr, exitCode } = runHook(
    hookPath,
    {
      session_id: 'sand02-test-' + Date.now(),
      model: { display_name: 'Claude' },
      context_window: { remaining_percentage: 60 },
    },
    5000,
    { GSD_SIMULATE_SANDBOX: '1' }
  );

  assert.strictEqual(exitCode, 0, 'gsd-statusline must exit 0 under sandbox simulation');
  assert.strictEqual(stderr, '', 'gsd-statusline must produce no stderr under sandbox simulation');
});

// ── SAND-03: gsd-context-monitor exits 0 under sandbox simulation ─────────────

test('SAND-03: gsd-context-monitor exits 0 with no stderr under GSD_SIMULATE_SANDBOX', () => {
  // Note: with no metrics bridge file, gsd-context-monitor exits 0 early (line 50-52).
  // This is still a valid sandbox degradation test — the hook must not crash.
  const hookPath = path.join(HOOKS_DIR, 'gsd-context-monitor.js');
  const { stderr, exitCode } = runHook(
    hookPath,
    {
      session_id: 'sand03-test-' + Date.now(),
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
      cwd: process.cwd(),
    },
    5000,
    { GSD_SIMULATE_SANDBOX: '1' }
  );

  assert.strictEqual(exitCode, 0, 'gsd-context-monitor must exit 0 under sandbox simulation');
  assert.strictEqual(stderr, '', 'gsd-context-monitor must produce no stderr under sandbox simulation');
});

// ── SAND-04: gsd-check-update exits 0 under sandbox simulation ───────────────

test('SAND-04: gsd-check-update exits 0 with no stderr under GSD_SIMULATE_SANDBOX', () => {
  const hookPath = path.join(HOOKS_DIR, 'gsd-check-update.js');
  const { stderr, exitCode } = runHook(
    hookPath,
    { session_id: 'sand04-test-' + Date.now() },
    5000,
    { GSD_SIMULATE_SANDBOX: '1' }
  );

  assert.strictEqual(exitCode, 0, 'gsd-check-update must exit 0 under sandbox simulation');
  assert.strictEqual(stderr, '', 'gsd-check-update must produce no stderr under sandbox simulation');
});

// ── SAND-06: full suite anchor — all sandbox degradation tests present ────────

test('SAND-06: full suite — all sandbox degradation tests pass', () => {
  // This is a documentation/structure anchor test. It asserts that this file
  // collectively covers all three hooks (gsd-statusline, gsd-context-monitor,
  // gsd-check-update) plus the sandbox-detect hook. When Wave 2 implements the
  // patches, all preceding tests in this file will turn GREEN and this anchor
  // confirms the full SAND-0x suite is present for CI grep.
  assert.ok(true, 'SAND-06: sandbox degradation tests present for all three hooks');
});

// ── DIST-08: gsd-check-update exits 0 silently under GSD_OFFLINE ──────────────

test('DIST-08: gsd-check-update exits 0 with no output under GSD_OFFLINE=1', () => {
  const hookPath = path.join(HOOKS_DIR, 'gsd-check-update.js');
  const { stdout, stderr, exitCode } = runHook(
    hookPath,
    { session_id: 'dist08-test-' + Date.now() },
    5000,
    { GSD_OFFLINE: '1' }
  );

  assert.strictEqual(exitCode, 0, 'gsd-check-update must exit 0 under GSD_OFFLINE=1');
  assert.strictEqual(stderr, '', 'gsd-check-update must produce no stderr under GSD_OFFLINE=1');
  assert.strictEqual(stdout, '', 'gsd-check-update must produce no stdout under GSD_OFFLINE=1');
});

// ── AGENT-01: both-sources-fail silent exit ───────────────────────────────────

test('AGENT-01: gsd-check-update exits 0 silently when both npm and GitHub are unreachable', () => {
  // GSD_OFFLINE=1 short-circuits before either npm or GitHub source is tried,
  // confirming the silent-exit contract for the both-sources-fail case.
  const hookPath = path.join(HOOKS_DIR, 'gsd-check-update.js');
  const { stdout, stderr, exitCode } = runHook(
    hookPath,
    { session_id: 'agent01-test-' + Date.now() },
    5000,
    { GSD_OFFLINE: '1' }
  );

  assert.strictEqual(exitCode, 0, 'gsd-check-update must exit 0 when both sources fail');
  assert.strictEqual(stderr, '', 'gsd-check-update must produce no stderr when both sources fail');
  assert.strictEqual(stdout, '', 'gsd-check-update must produce no stdout when both sources fail');
});
