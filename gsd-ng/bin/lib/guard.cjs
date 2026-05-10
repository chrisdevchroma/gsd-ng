'use strict';
const fs = require('fs');
const { output, error } = require('./core.cjs');
const { setConfigValue } = require('./config.cjs');

/**
 * Guard: sync-chain — Sync auto-chain flag with invocation intent.
 *
 * If user invoked without --auto, clear the ephemeral _auto_chain_active flag
 * from any previous interrupted --auto chain. This prevents stale flags from
 * causing unwanted auto-advance.
 *
 * Replaces inline bash guard blocks in execute-phase.md, plan-phase.md,
 * discuss-phase.md that used `if [[ "$ARGUMENTS" != *"--auto"* ]]` which
 * broke due to Claude Code Bash tool escaping != to \!=.
 *
 * @param {string} cwd - Working directory
 * @param {string} argumentsStr - Raw $ARGUMENTS string from workflow
 */
function cmdGuardSyncChain(cwd, argumentsStr) {
  // Check for --auto as a standalone token (not substring like --auto-advance)
  const tokens = (argumentsStr || '').split(/\s+/);
  const hasAuto = tokens.includes('--auto');

  if (!hasAuto) {
    // Clear stale auto-chain flag from previous --auto runs
    setConfigValue(cwd, 'workflow._auto_chain_active', false);
  }

  output({ synced: true, had_auto: hasAuto });
}

/**
 * Guard: init-valid — Validate that $INIT is non-empty and parses as valid JSON.
 *
 * Exits 0 if the input is a non-empty, valid JSON string.
 * Exits 1 with a clear error message if the input is empty, whitespace-only,
 * or fails JSON.parse — indicating that the preceding init command failed.
 *
 * @param {string} jsonStr - The $INIT string to validate
 */
function cmdGuardInitValid(jsonStr) {
  if (!jsonStr || !jsonStr.trim()) {
    error(
      'guard init-valid: $INIT is empty or malformed — did the init command fail?',
    );
  }
  try {
    JSON.parse(jsonStr);
  } catch {
    error(
      'guard init-valid: $INIT is empty or malformed — did the init command fail?',
    );
  }
  output({ valid: true });
}

/**
 * Guard: init-valid-file — Same semantics as init-valid, but reads JSON from a
 * file instead of from a $(...) capture. Used by workflows that have replaced
 * `INIT=$(node ... init <op>)` with `node ... init <op> > /tmp/init.json`
 * to avoid Claude Code's expansion-guard prompt on `$()`.
 *
 * Exits 0 if the file exists, is non-empty, and parses as valid JSON.
 * Exits 1 with a clear error message otherwise.
 *
 * @param {string} filePath - Path to the JSON file to validate
 */
function cmdGuardInitValidFile(filePath) {
  if (!filePath) {
    error('guard init-valid-file: usage init-valid-file <path>');
  }
  let content;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    error(
      'guard init-valid-file: cannot read ' +
        filePath +
        ' — did the init command fail?',
    );
  }
  if (!content || !content.trim()) {
    error(
      'guard init-valid-file: ' +
        filePath +
        ' is empty — did the init command fail?',
    );
  }
  try {
    JSON.parse(content);
  } catch {
    error(
      'guard init-valid-file: ' +
        filePath +
        ' is not valid JSON — did the init command fail?',
    );
  }
  output({ valid: true });
}

module.exports = {
  cmdGuardSyncChain,
  cmdGuardInitValid,
  cmdGuardInitValidFile,
};
