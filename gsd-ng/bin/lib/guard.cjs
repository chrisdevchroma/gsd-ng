'use strict';
const { output, error } = require('./core.cjs');
const { setConfigValue } = require('./config.cjs');

const CHAIN_OPERATIONS = new Set(['enter', 'preserve', 'reset']);

/**
 * Detect standalone automatic-mode intent without consulting project state.
 * Invocation text remains prompt data; this helper has no filesystem effects.
 *
 * @param {string} argumentsStr - Exact invocation text from the inert block
 * @returns {boolean} whether a standalone --auto token is present
 */
function hasStandaloneAuto(argumentsStr) {
  return (argumentsStr || '').split(/\s+/).includes('--auto');
}

/**
 * Guard: sync-chain — Apply one explicit auto-chain lifecycle transition.
 *
 * @param {string} cwd - Working directory
 * @param {'enter'|'preserve'|'reset'} operation - Static transition selected
 *   by the workflow, never raw invocation text
 */
function cmdGuardSyncChain(cwd, operation) {
  if (!CHAIN_OPERATIONS.has(operation)) {
    error(
      `guard sync-chain operation must be one of: enter, preserve, reset (received ${JSON.stringify(operation)})`,
    );
  }

  if (operation === 'preserve') {
    output({ synced: true, operation });
    return;
  }

  const active = operation === 'enter';
  setConfigValue(cwd, 'workflow._auto_chain_active', active);
  output({ synced: true, operation, active });
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

module.exports = {
  hasStandaloneAuto,
  cmdGuardSyncChain,
  cmdGuardInitValid,
};
