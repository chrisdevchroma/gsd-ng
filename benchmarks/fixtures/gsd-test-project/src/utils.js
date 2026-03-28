'use strict';

/**
 * Parse a JSON config string into a config object.
 * BUG: crashes on empty string, null, or malformed JSON.
 */
function parseConfig(input) {
  // BUG: no guard for empty/null/malformed input
  const parsed = JSON.parse(input);
  return parsed;
}

/**
 * Format a widget object for display.
 */
function formatWidget(widget) {
  return `[${widget.type}] ${widget.name}`;
}

module.exports = { parseConfig, formatWidget };
