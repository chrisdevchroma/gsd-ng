'use strict';

const fs = require('fs');
const path = require('path');

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
    const regex = new RegExp(
      '<!-- ONLY:' + rt + ' -->([\\s\\S]*?)<!-- /ONLY:' + rt + ' -->',
      'g',
    );
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
      throw new Error(
        'Unbalanced ONLY:' +
          key +
          ' markers: ' +
          (opens[key] || 0) +
          ' opens, ' +
          (closes[key] || 0) +
          ' closes',
      );
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

/**
 * Append a template block to a file. Creates the file if it doesn't exist.
 * Idempotent: skips if the marker string is already present in the file.
 *
 * @param {string} filePath - Absolute path to target file
 * @param {string} templatePath - Absolute path to template file
 * @param {string} marker - String to check for idempotency
 */
function injectAppendToFile(filePath, templatePath, marker) {
  if (fs.existsSync(filePath)) {
    const existing = fs.readFileSync(filePath, 'utf8');
    if (existing.includes(marker)) {
      return; // Already injected
    }
  }
  if (!fs.existsSync(templatePath)) {
    return; // Template missing — skip silently
  }
  const blockContent = fs.readFileSync(templatePath, 'utf8').trim();
  const block = '\n' + blockContent + '\n';
  if (fs.existsSync(filePath)) {
    fs.appendFileSync(filePath, block, 'utf8');
  } else {
    fs.writeFileSync(filePath, block.trimStart(), 'utf8');
  }
}

/**
 * Fill content between a pair of markers in a file, using the inner content
 * extracted from between the same markers in a template file.
 * Idempotent: always overwrites to stay in sync with the template.
 * No-op if the file does not exist or either marker is missing.
 *
 * @param {string} filePath - Absolute path to the target file containing the markers
 * @param {string} templatePath - Absolute path to the template file
 * @param {string} startMarker - Opening marker string
 * @param {string} endMarker - Closing marker string
 */
function fillBetweenMarkers(filePath, templatePath, startMarker, endMarker) {
  if (!fs.existsSync(filePath)) return;
  const existing = fs.readFileSync(filePath, 'utf8');
  const startIdx = existing.indexOf(startMarker);
  const endIdx = existing.indexOf(endMarker);
  if (startIdx === -1 || endIdx === -1) return;

  const template = fs.readFileSync(templatePath, 'utf8');
  const tStart = template.indexOf(startMarker);
  const tEnd = template.indexOf(endMarker);
  const innerContent =
    tStart !== -1 && tEnd !== -1
      ? template.slice(tStart + startMarker.length, tEnd)
      : '\n' + template.trim() + '\n';

  const before = existing.slice(0, startIdx + startMarker.length);
  const after = existing.slice(endIdx);
  fs.writeFileSync(filePath, before + innerContent + after, 'utf8');
}

module.exports = {
  processTemplate,
  validateMarkers,
  buildContext,
  RUNTIMES,
  injectAppendToFile,
  fillBetweenMarkers,
};
