/**
 * Unit tests for gsd-ng/bin/lib/effort-sync.cjs
 *
 * RED STATE: these tests require the `effort-sync.cjs` module which is
 * created in Plan 02. Running this file BEFORE Plan 02 lands MUST fail with
 * MODULE_NOT_FOUND — that is the intended Nyquist gate.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { createTempProjectWithAgents, cleanup } = require('./helpers.cjs');
const { extractFrontmatter } = require('../gsd-ng/bin/lib/frontmatter.cjs');
const { syncAgentEffortFrontmatter, formatRestartNotice } = require('../gsd-ng/bin/lib/effort-sync.cjs');

function readEffort(agentFile) {
  const fm = extractFrontmatter(fs.readFileSync(agentFile, 'utf-8'));
  return fm.effort !== undefined ? fm.effort : null;
}

describe('syncAgentEffortFrontmatter', () => {
  let tmpDir;
  afterEach(() => { if (tmpDir) cleanup(tmpDir); });

  test('writes effort: frontmatter from quality profile', () => {
    tmpDir = createTempProjectWithAgents(['gsd-planner', 'gsd-executor'], {
      config: { runtime: 'claude', model_profile: 'quality' },
    });
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    const result = syncAgentEffortFrontmatter(tmpDir, agentsDir);
    assert.ok(Array.isArray(result.changes), 'changes must be an array');
    assert.strictEqual(readEffort(path.join(agentsDir, 'gsd-planner.md')), 'max');
    assert.strictEqual(readEffort(path.join(agentsDir, 'gsd-executor.md')), 'high');
    assert.strictEqual(result.changes.length, 2);
  });

  test('removes effort: field when resolver returns null (balanced → inherit)', () => {
    tmpDir = createTempProjectWithAgents(['gsd-planner'], {
      config: { runtime: 'claude', model_profile: 'balanced' },
    });
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    // Seed an existing effort: field that must be removed
    const file = path.join(agentsDir, 'gsd-planner.md');
    const orig = fs.readFileSync(file, 'utf-8');
    fs.writeFileSync(file, orig.replace(/^---\n/, '---\neffort: high\n'));
    syncAgentEffortFrontmatter(tmpDir, agentsDir);
    const after = fs.readFileSync(file, 'utf-8');
    assert.ok(!/^effort:/m.test(after.split('---')[1] || ''), 'effort field must be removed');
  });

  test('is idempotent — second call reports no changes', () => {
    tmpDir = createTempProjectWithAgents(['gsd-planner', 'gsd-executor'], {
      config: { runtime: 'claude', model_profile: 'quality' },
    });
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    syncAgentEffortFrontmatter(tmpDir, agentsDir);
    const second = syncAgentEffortFrontmatter(tmpDir, agentsDir);
    assert.strictEqual(second.changes.length, 0, 'second sync must report zero changes');
  });

  test('skips non-claude runtime and returns skipped: true', () => {
    tmpDir = createTempProjectWithAgents(['gsd-planner'], {
      config: { runtime: 'copilot', model_profile: 'quality' },
    });
    const agentsDir = path.join(tmpDir, '.claude', 'agents');
    const result = syncAgentEffortFrontmatter(tmpDir, agentsDir);
    assert.strictEqual(result.skipped, true);
    assert.strictEqual(result.changes.length, 0);
    assert.strictEqual(readEffort(path.join(agentsDir, 'gsd-planner.md')), null);
  });
});

describe('formatRestartNotice', () => {
  test('returns restart notice when changes exist', () => {
    const msg = formatRestartNotice([{ agent: 'gsd-planner', effort: 'max' }]);
    assert.strictEqual(msg, 'Restart Claude Code to apply effort changes.');
  });

  test('returns empty string when no changes', () => {
    assert.strictEqual(formatRestartNotice([]), '');
  });
});
