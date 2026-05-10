'use strict';
const { spawnSync } = require('child_process');

/**
 * Spawn a hook process with JSON stdin.
 * Always returns {stdout, stderr, exitCode} — never throws.
 * Mirrors the always-return, never-throw convention from helpers.cjs.
 *
 * @param {string} hookPath      - Absolute path to hook .js file
 * @param {object} payload       - JSON object sent as stdin
 * @param {number} [timeout]     - spawnSync timeout ms (default: 5000)
 * @param {object} [envOverrides] - Extra env vars merged on top of process.env (default: {})
 * @returns {{ stdout: string, stderr: string, exitCode: number }}
 */
function runHook(hookPath, payload, timeout = 5000, envOverrides = {}) {
  const result = spawnSync(process.execPath, [hookPath], {
    input: JSON.stringify(payload),
    encoding: 'utf8',
    timeout,
    env: { ...process.env, ...envOverrides },
  });
  return {
    stdout: (result.stdout || '').trim(),
    stderr: (result.stderr || '').trim(),
    exitCode: result.status ?? 1,
  };
}

module.exports = { runHook };
