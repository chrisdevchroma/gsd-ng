'use strict';

const RUNTIMES = {
  claude: {
    PROJECT_RULES_FILE: 'CLAUDE.md',
    USER_QUESTION_TOOL: 'AskUserQuestion',
  },
  copilot: {
    PROJECT_RULES_FILE: '.github/copilot-instructions.md',
    USER_QUESTION_TOOL: 'TBD',
  },
};

/**
 * Process a template string by resolving conditional blocks and substituting variables.
 *
 * 1. Validates balanced ONLY markers
 * 2. Resolves <!-- ONLY:runtime --> conditional blocks (keep matching, strip non-matching)
 * 3. Substitutes {{VAR}} using a replacer function (avoids $ backreference bugs)
 *
 * @param {string} content - Template content
 * @param {object} context - Must include `runtime` key; additional keys used as variables
 * @returns {string} Processed content
 */
function processTemplate(content, context) {
  let out = content;

  // 1. Validate markers (balanced open/close)
  validateMarkers(out);

  // 2. Resolve conditional blocks
  for (const rt of Object.keys(RUNTIMES)) {
    const regex = new RegExp('<!-- ONLY:' + rt + ' -->([\\s\\S]*?)<!-- /ONLY:' + rt + ' -->', 'g');
    if (rt === context.runtime) {
      out = out.replace(regex, (_, inner) => inner);
    } else {
      out = out.replace(regex, () => '');
    }
  }

  // 3. Substitute {{VAR}} using replacer function (avoids $ backreference bugs)
  out = out.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    const runtimeVars = RUNTIMES[context.runtime] || {};
    if (key in runtimeVars) return runtimeVars[key];
    if (key in context) return String(context[key]);
    return match; // leave unresolved as-is
  });

  return out;
}

/**
 * Validate that all <!-- ONLY:X --> markers are balanced (each open has a matching close).
 *
 * @param {string} content - Content to validate
 * @throws {Error} If markers are unbalanced
 */
function validateMarkers(content) {
  const openPattern = /<!-- ONLY:(\w+) -->/g;
  const closePattern = /<!-- \/ONLY:(\w+) -->/g;
  const opens = {};
  const closes = {};
  let m;
  while ((m = openPattern.exec(content)) !== null) {
    opens[m[1]] = (opens[m[1]] || 0) + 1;
  }
  while ((m = closePattern.exec(content)) !== null) {
    closes[m[1]] = (closes[m[1]] || 0) + 1;
  }
  const allKeys = new Set(Object.keys(opens).concat(Object.keys(closes)));
  for (const key of allKeys) {
    if ((opens[key] || 0) !== (closes[key] || 0)) {
      throw new Error('Unbalanced ONLY:' + key + ' markers: ' + (opens[key] || 0) + ' opens, ' + (closes[key] || 0) + ' closes');
    }
  }
}

/**
 * Build a context object for template processing.
 *
 * @param {string} runtime - Runtime name (e.g. 'claude', 'copilot')
 * @param {object} [options] - Additional key-value pairs to merge
 * @returns {object} Context with runtime and any extra options
 */
function buildContext(runtime, options) {
  return { runtime, ...(options || {}) };
}

module.exports = { processTemplate, validateMarkers, buildContext, RUNTIMES };
