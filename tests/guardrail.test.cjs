'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runHook } = require('./hook-harness.cjs');
const fs = require('fs');
const path = require('path');
const { resolveTmpDir, cleanup: cleanupDir } = require('./helpers.cjs');

const HOOK_PATH = path.resolve(__dirname, '..', 'hooks', 'gsd-guardrail.js');

/**
 * Helper: create a unique temp directory with optional GSD project setup.
 * Returns { tmpDir, cleanup }.
 */
function makeTmpDir(prefix = 'gsd-guardrail-test-') {
  const tmpDir = fs.mkdtempSync(path.join(resolveTmpDir(), prefix));
  return {
    tmpDir,
    cleanup: () => cleanupDir(tmpDir),
  };
}

/**
 * Helper: make a temp dir that looks like a GSD project (has .planning/STATE.md).
 */
function makeGsdProject(prefix = 'gsd-guardrail-test-') {
  const { tmpDir, cleanup } = makeTmpDir(prefix);
  fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  fs.writeFileSync(path.join(tmpDir, '.planning', 'STATE.md'), '# Project State\n');
  return { tmpDir, cleanup };
}

// ── Test 1: emits advisory when Edit targets project file in GSD project ─────

test('emits advisory when Edit targets project file in GSD project', () => {
  const { tmpDir, cleanup } = makeGsdProject();
  try {
    const { stdout, exitCode } = runHook(HOOK_PATH, {
      event: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/app.js' },
      session_id: 'test-guardrail-' + Date.now(),
      cwd: tmpDir,
    });

    assert.strictEqual(exitCode, 0, 'Hook must exit 0 (advisory only)');

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${JSON.stringify(stdout)}`);
    }

    assert.strictEqual(typeof parsed.additionalContext, 'string',
      'additionalContext must be a string');
    assert.ok(parsed.additionalContext.includes('GSD WORKFLOW REMINDER'),
      'additionalContext must contain "GSD WORKFLOW REMINDER"');
  } finally {
    cleanup();
  }
});

// ── Test 2: silent exit when no STATE.md (not GSD project) ───────────────────

test('silent exit when no STATE.md (not GSD project)', () => {
  const { tmpDir, cleanup } = makeTmpDir();
  try {
    const { stdout, exitCode } = runHook(HOOK_PATH, {
      event: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/app.js' },
      session_id: 'test-guardrail-' + Date.now(),
      cwd: tmpDir,
    });

    assert.strictEqual(exitCode, 0, 'Hook must exit 0');
    assert.strictEqual(stdout, '', 'stdout must be empty (not a GSD project)');
  } finally {
    cleanup();
  }
});

// ── Test 3: silent exit when editing .planning/ files ────────────────────────

test('silent exit when editing .planning/ files', () => {
  const { tmpDir, cleanup } = makeGsdProject();
  try {
    const { stdout, exitCode } = runHook(HOOK_PATH, {
      event: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '.planning/STATE.md' },
      session_id: 'test-guardrail-' + Date.now(),
      cwd: tmpDir,
    });

    assert.strictEqual(exitCode, 0, 'Hook must exit 0');
    assert.strictEqual(stdout, '', 'stdout must be empty (editing GSD internal file)');
  } finally {
    cleanup();
  }
});

// ── Test 4: silent exit when editing .claude/ files ──────────────────────────

test('silent exit when editing .claude/ files', () => {
  const { tmpDir, cleanup } = makeGsdProject();
  try {
    const { stdout, exitCode } = runHook(HOOK_PATH, {
      event: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '.claude/settings.json' },
      session_id: 'test-guardrail-' + Date.now(),
      cwd: tmpDir,
    });

    assert.strictEqual(exitCode, 0, 'Hook must exit 0');
    assert.strictEqual(stdout, '', 'stdout must be empty (editing GSD internal file)');
  } finally {
    cleanup();
  }
});

// ── Test 5: emits advisory for EnterPlanMode tool ────────────────────────────

test('emits advisory for EnterPlanMode tool', () => {
  const { tmpDir, cleanup } = makeGsdProject();
  try {
    const { stdout, exitCode } = runHook(HOOK_PATH, {
      event: 'PreToolUse',
      tool_name: 'EnterPlanMode',
      tool_input: {},
      session_id: 'test-guardrail-' + Date.now(),
      cwd: tmpDir,
    });

    assert.strictEqual(exitCode, 0, 'Hook must exit 0 (advisory only)');

    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${JSON.stringify(stdout)}`);
    }

    assert.strictEqual(typeof parsed.additionalContext, 'string',
      'additionalContext must be a string');
    assert.ok(parsed.additionalContext.includes('native plan mode'),
      'additionalContext must mention "native plan mode"');
  } finally {
    cleanup();
  }
});

// ── Test 6: suppressed by GSD_NO_GUARDRAIL=1 ─────────────────────────────────

test('suppressed by GSD_NO_GUARDRAIL=1', () => {
  const { tmpDir, cleanup } = makeGsdProject();
  try {
    const { stdout, exitCode } = runHook(
      HOOK_PATH,
      {
        event: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: 'src/app.js' },
        session_id: 'test-guardrail-' + Date.now(),
        cwd: tmpDir,
      },
      5000,
      { GSD_NO_GUARDRAIL: '1' }
    );

    assert.strictEqual(exitCode, 0, 'Hook must exit 0');
    assert.strictEqual(stdout, '', 'stdout must be empty (suppressed by env var)');
  } finally {
    cleanup();
  }
});

// ── Test 7: logs event to guardrail-events.log ───────────────────────────────

test('logs event to guardrail-events.log', () => {
  const { tmpDir: projectDir, cleanup: cleanupProject } = makeGsdProject();
  const { tmpDir: tmpLogDir, cleanup: cleanupLog } = makeTmpDir('gsd-guardrail-log-');

  try {
    const { exitCode } = runHook(
      HOOK_PATH,
      {
        event: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: 'src/app.js' },
        session_id: 'test-guardrail-' + Date.now(),
        cwd: projectDir,
      },
      5000,
      { GSD_GUARDRAIL_LOG_DIR: tmpLogDir }
    );

    assert.strictEqual(exitCode, 0, 'Hook must exit 0');

    const logFile = path.join(tmpLogDir, 'guardrail-events.log');
    assert.ok(fs.existsSync(logFile), 'guardrail-events.log must be created');

    const logContent = fs.readFileSync(logFile, 'utf8').trim();
    assert.ok(logContent.length > 0, 'Log file must not be empty');

    // Parse the JSONL line
    let logEntry;
    try {
      logEntry = JSON.parse(logContent.split('\n')[0]);
    } catch (e) {
      assert.fail(`Log entry is not valid JSON: ${JSON.stringify(logContent)}`);
    }

    assert.ok(typeof logEntry.ts === 'string', 'Log entry must have ts field');
    assert.ok(typeof logEntry.event === 'string', 'Log entry must have event field');
    assert.ok(typeof logEntry.tool === 'string', 'Log entry must have tool field');
    assert.ok('file' in logEntry, 'Log entry must have file field');
  } finally {
    cleanupProject();
    cleanupLog();
  }
});

// ── Test 8: never outputs hookSpecificOutput ──────────────────────────────────

test('never outputs hookSpecificOutput', () => {
  const { tmpDir, cleanup } = makeGsdProject();
  try {
    const { stdout, exitCode } = runHook(HOOK_PATH, {
      event: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/app.js' },
      session_id: 'test-guardrail-' + Date.now(),
      cwd: tmpDir,
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
    assert.strictEqual(parsed.hookSpecificOutput, undefined,
      'hookSpecificOutput must NOT be present');
  } finally {
    cleanup();
  }
});

// ── Test 10: exits 0 with empty stdout on malformed JSON input ───────────────

test('exits 0 with empty stdout on malformed JSON input', () => {
  const { spawnSync } = require('child_process');
  const result = spawnSync(process.execPath, [HOOK_PATH], {
    input: 'not valid json {{{',
    encoding: 'utf8',
    timeout: 5000,
    env: { ...process.env },
  });
  assert.strictEqual(result.status, 0, 'Must exit 0 on malformed input');
  assert.strictEqual((result.stdout || '').trim(), '', 'Must produce no stdout on malformed input');
});

// ── Test 11: exits 0 and emits advisory even when log directory write fails ───

test('exits 0 and emits advisory even when log directory write fails', () => {
  const { tmpDir, cleanup } = makeGsdProject();
  try {
    // Create a file where the log directory should be — mkdirSync will fail
    const badLogDir = path.join(tmpDir, 'not-a-dir');
    fs.writeFileSync(badLogDir, 'I am a file, not a directory');

    const { stdout, exitCode } = runHook(
      HOOK_PATH,
      {
        event: 'PreToolUse',
        tool_name: 'Edit',
        tool_input: { file_path: 'src/app.js' },
        session_id: 'test-guardrail-logfail-' + Date.now(),
        cwd: tmpDir,
      },
      5000,
      { GSD_GUARDRAIL_LOG_DIR: badLogDir }
    );

    assert.strictEqual(exitCode, 0, 'Must exit 0 even when log dir is broken');
    // Advisory fires before logEvent — stdout should still have the advisory
    let parsed;
    try {
      parsed = JSON.parse(stdout);
    } catch (e) {
      assert.fail(`stdout is not valid JSON: ${JSON.stringify(stdout)}`);
    }
    assert.strictEqual(typeof parsed.additionalContext, 'string',
      'additionalContext must still be emitted even when logging fails');
    assert.ok(parsed.additionalContext.includes('GSD WORKFLOW REMINDER'),
      'advisory message must contain GSD WORKFLOW REMINDER');
  } finally {
    cleanup();
  }
});

// ── Test 9: suppressed by workflow.guardrail_enabled: false in config ─────────

test('suppressed by workflow.guardrail_enabled: false in config', () => {
  const { tmpDir, cleanup } = makeGsdProject();
  try {
    // Write config.json with guardrail disabled
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ workflow: { guardrail_enabled: false } })
    );

    const { stdout, exitCode } = runHook(HOOK_PATH, {
      event: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: 'src/app.js' },
      session_id: 'test-guardrail-' + Date.now(),
      cwd: tmpDir,
    });

    assert.strictEqual(exitCode, 0, 'Hook must exit 0');
    assert.strictEqual(stdout, '', 'stdout must be empty (suppressed by persistent config)');
  } finally {
    cleanup();
  }
});
