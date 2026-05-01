'use strict';

/**
 * effort-sync — Writes resolved effort: frontmatter into deployed Claude agent files.
 *
 * Single call site for install.js, cmdConfigSetModelProfile, cmdConfigSet
 * (effort_overrides.*), and the `gsd sync-agents` CLI.
 *
 * Trusts resolveEffortInternal's null semantics completely:
 *   - null return → remove the `effort:` field from frontmatter
 *   - string return → write `effort: <value>` to frontmatter
 *
 * Does its OWN before/after change detection because the frontmatter setter always
 * writes the file unconditionally (no short-circuit on unchanged values).
 */

const fs = require('fs');
const path = require('path');
const { loadConfig, resolveEffortInternal } = require('./core.cjs');
const { EFFORT_PROFILES } = require('./model-profiles.cjs');
const { extractFrontmatter, spliceFrontmatter } = require('./frontmatter.cjs');

const RESTART_NOTICE = 'Restart Claude Code to apply effort changes.';

/**
 * Sync `effort:` frontmatter across all 16 GSD agent files.
 *
 * @param {string} cwd - Project root (where .planning/config.json lives).
 * @param {string} agentsDir - Directory containing gsd-*.md agent files.
 * @returns {{ changes: Array<{agent: string, effort: string|null}>, skipped?: boolean }}
 */
function syncAgentEffortFrontmatter(cwd, agentsDir) {
  const config = loadConfig(cwd) || {};
  if (config.runtime && config.runtime !== 'claude') {
    return { skipped: true, changes: [] };
  }

  if (!agentsDir || !fs.existsSync(agentsDir)) {
    return { changes: [] };
  }

  const changes = [];
  for (const agentType of Object.keys(EFFORT_PROFILES)) {
    const agentFile = path.join(agentsDir, `${agentType}.md`);
    if (!fs.existsSync(agentFile)) continue;

    const content = fs.readFileSync(agentFile, 'utf-8');
    const fm = extractFrontmatter(content);
    const existing =
      fm.effort !== undefined && fm.effort !== null ? fm.effort : null;
    const resolved = resolveEffortInternal(cwd, agentType); // null means omit

    if (existing === resolved) continue; // idempotent short-circuit

    if (resolved === null) {
      delete fm.effort;
    } else {
      fm.effort = resolved;
    }
    const newContent = spliceFrontmatter(content, fm);
    fs.writeFileSync(agentFile, newContent, 'utf-8');
    changes.push({ agent: agentType, effort: resolved });
  }

  return { changes };
}

/**
 * Returns the canonical restart notice string, or '' when no changes occurred.
 * Wording is locked by CONTEXT.md §"Restart-required notice UX (Area 4)".
 *
 * @param {Array<{agent: string, effort: string|null}>} changes - Array of applied changes
 * @returns {string} Restart notice string, or '' if no changes occurred.
 */
function formatRestartNotice(changes) {
  if (!changes || changes.length === 0) return '';
  return RESTART_NOTICE;
}

module.exports = {
  syncAgentEffortFrontmatter,
  formatRestartNotice,
};
