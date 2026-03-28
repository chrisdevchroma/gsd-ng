'use strict';
const { output } = require('./core.cjs');
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
 * @param {boolean} raw - Raw output flag
 */
function cmdGuardSyncChain(cwd, argumentsStr, raw) {
  // Check for --auto as a standalone token (not substring like --auto-advance)
  const tokens = (argumentsStr || '').split(/\s+/);
  const hasAuto = tokens.includes('--auto');

  if (!hasAuto) {
    // Clear stale auto-chain flag from previous --auto runs
    setConfigValue(cwd, 'workflow._auto_chain_active', false);
  }

  output({ synced: true, had_auto: hasAuto }, raw);
}

module.exports = { cmdGuardSyncChain };
