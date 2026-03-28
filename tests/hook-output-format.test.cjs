'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runHook } = require('./hook-harness.cjs');
const fs = require('fs');
const os = require('os');
const path = require('path');

const HOOKS_DIR = path.resolve(__dirname, '..', 'hooks');

// ── gsd-context-monitor.js (PostToolUse — emits JSON) ─────────────────────────

test('gsd-context-monitor emits flat additionalContext, not hookSpecificOutput', () => {
  const session = 'phase2-test-' + Date.now();
  const metricsPath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
  const warnPath = path.join(os.tmpdir(), `claude-ctx-${session}-warned.json`);

  fs.writeFileSync(metricsPath, JSON.stringify({
    session_id: session,
    remaining_percentage: 20,
    used_pct: 80,
    timestamp: Math.floor(Date.now() / 1000),
  }));

  try {
    const hookPath = path.join(HOOKS_DIR, 'gsd-context-monitor.js');
    const { stdout, exitCode } = runHook(hookPath, {
      session_id: session,
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
      cwd: process.cwd(),
    });

    assert.strictEqual(exitCode, 0, 'Hook must exit 0');

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${JSON.stringify(stdout)}`);
    }

    assert.strictEqual(typeof parsed.additionalContext, 'string',
      'additionalContext must be a string');
    assert.ok(!parsed.hookSpecificOutput,
      'hookSpecificOutput must NOT be present');
  } finally {
    fs.rmSync(metricsPath, { force: true });
    fs.rmSync(warnPath, { force: true });
  }
});

// ── gsd-statusline.js (Statusline — emits plain text/ANSI) ────────────────────

test('gsd-statusline exits 0 and outputs non-empty text', () => {
  const hookPath = path.join(HOOKS_DIR, 'gsd-statusline.js');
  const { stdout, exitCode } = runHook(hookPath, {
    session_id: 'test-session-statusline',
    model: { display_name: 'Claude' },
    context_window: { remaining_percentage: 60 },
  });

  assert.strictEqual(exitCode, 0, 'Statusline must exit 0');
  assert.ok(stdout.length > 0, 'Statusline must produce non-empty output');
});

// ── gsd-check-update.js (SessionStart — no stdout, exits 0) ──────────────────

test('gsd-check-update exits 0 without crashing', () => {
  const hookPath = path.join(HOOKS_DIR, 'gsd-check-update.js');
  const { exitCode } = runHook(hookPath, {
    session_id: 'test-session-update',
  });

  assert.strictEqual(exitCode, 0, 'check-update must exit 0');
});

// ── HOOK-07: regression guard ─────────────────────────────────────────────────

test('HOOK-07: hookSpecificOutput must not appear in context-monitor stdout', () => {
  const session = 'hook07-test-' + Date.now();
  const metricsPath = path.join(os.tmpdir(), `claude-ctx-${session}.json`);
  const warnPath = path.join(os.tmpdir(), `claude-ctx-${session}-warned.json`);

  fs.writeFileSync(metricsPath, JSON.stringify({
    session_id: session,
    remaining_percentage: 20,
    used_pct: 80,
    timestamp: Math.floor(Date.now() / 1000),
  }));

  try {
    const hookPath = path.join(HOOKS_DIR, 'gsd-context-monitor.js');
    const { stdout, exitCode } = runHook(hookPath, {
      session_id: session,
      tool_name: 'Bash',
      tool_input: { command: 'echo hi' },
      cwd: process.cwd(),
    });

    assert.strictEqual(exitCode, 0, 'Hook must exit 0');

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${JSON.stringify(stdout)}`);
    }

    assert.ok(!parsed.hookSpecificOutput,
      'hookSpecificOutput must not be present');
  } finally {
    fs.rmSync(metricsPath, { force: true });
    fs.rmSync(warnPath, { force: true });
  }
});
