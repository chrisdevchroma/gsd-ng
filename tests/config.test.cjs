/**
 * GSD Tools Tests - config.cjs
 *
 * CLI integration tests for config-ensure-section, config-set, and config-get
 * commands exercised through gsd-tools.cjs via execSync.
 *
 * Requirements: TEST-13
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { runGsdTools, createTempProject, cleanup, resolveTmpDir } = require('./helpers.cjs');

// ─── helpers ──────────────────────────────────────────────────────────────────

function readConfig(tmpDir) {
  const configPath = path.join(tmpDir, '.planning', 'config.json');
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}

function writeConfig(tmpDir, obj) {
  const configPath = path.join(tmpDir, '.planning', 'config.json');
  fs.writeFileSync(configPath, JSON.stringify(obj, null, 2), 'utf-8');
}

// ─── config-ensure-section ───────────────────────────────────────────────────

describe('config-ensure-section command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates config.json with expected structure and types', () => {
    const result = runGsdTools('config-ensure-section', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const config = readConfig(tmpDir);
    // Verify structure and types — exact values may vary if ~/.gsd/defaults.json exists
    assert.strictEqual(typeof config.model_profile, 'string');
    assert.strictEqual(typeof config.commit_docs, 'boolean');
    assert.strictEqual(typeof config.parallelization, 'boolean');
    assert.strictEqual(typeof config.branching_strategy, 'string');
    assert.ok(config.workflow && typeof config.workflow === 'object', 'workflow should be an object');
    assert.strictEqual(typeof config.workflow.research, 'boolean');
    assert.strictEqual(typeof config.workflow.plan_check, 'boolean');
    assert.strictEqual(typeof config.workflow.verifier, 'boolean');
    assert.strictEqual(typeof config.workflow.nyquist_validation, 'boolean');
    // These hardcoded defaults are always present (may be overridden by user defaults)
    assert.ok('model_profile' in config, 'model_profile should exist');
    assert.ok('search_gitignored' in config, 'search_gitignored should exist');
  });

  test('is idempotent — returns already_exists on second call', () => {
    const first = runGsdTools('config-ensure-section', tmpDir);
    assert.ok(first.success, `First call failed: ${first.error}`);
    const firstOutput = JSON.parse(first.output);
    assert.strictEqual(firstOutput.created, true);

    const second = runGsdTools('config-ensure-section', tmpDir);
    assert.ok(second.success, `Second call failed: ${second.error}`);
    const secondOutput = JSON.parse(second.output);
    assert.strictEqual(secondOutput.created, false);
    assert.strictEqual(secondOutput.reason, 'already_exists');
  });

  // Use a temp HOME so we don't touch the real ~/.gsd/ (sandbox-safe)
  test('merges user defaults from defaults.json', () => {
    const tmpHome = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-home-'));
    fs.mkdirSync(path.join(tmpHome, '.gsd'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.gsd', 'defaults.json'), JSON.stringify({
      model_profile: 'quality',
      commit_docs: false,
    }), 'utf-8');

    try {
      const result = runGsdTools('config-ensure-section', tmpDir, { HOME: tmpHome });
      assert.ok(result.success, `Command failed: ${result.error}`);

      const config = readConfig(tmpDir);
      assert.strictEqual(config.model_profile, 'quality', 'model_profile should be overridden');
      assert.strictEqual(config.commit_docs, false, 'commit_docs should be overridden');
      assert.strictEqual(typeof config.branching_strategy, 'string', 'branching_strategy should be a string');
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  // Use a temp HOME so we don't touch the real ~/.gsd/ (sandbox-safe)
  test('merges nested workflow keys from defaults.json preserving unset keys', () => {
    const tmpHome = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-home-'));
    fs.mkdirSync(path.join(tmpHome, '.gsd'), { recursive: true });
    fs.writeFileSync(path.join(tmpHome, '.gsd', 'defaults.json'), JSON.stringify({
      workflow: { research: false },
    }), 'utf-8');

    try {
      const result = runGsdTools('config-ensure-section', tmpDir, { HOME: tmpHome });
      assert.ok(result.success, `Command failed: ${result.error}`);

      const config = readConfig(tmpDir);
      assert.strictEqual(config.workflow.research, false, 'research should be overridden');
      assert.strictEqual(typeof config.workflow.plan_check, 'boolean', 'plan_check should be a boolean');
      assert.strictEqual(typeof config.workflow.verifier, 'boolean', 'verifier should be a boolean');
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});

// ─── config-set ──────────────────────────────────────────────────────────────

describe('config-set command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create initial config
    runGsdTools('config-ensure-section', tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('sets a top-level string value', () => {
    const result = runGsdTools('config-set model_profile quality', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.updated, true);
    assert.strictEqual(output.key, 'model_profile');
    assert.strictEqual(output.value, 'quality');

    const config = readConfig(tmpDir);
    assert.strictEqual(config.model_profile, 'quality');
  });

  test('coerces true to boolean', () => {
    const result = runGsdTools('config-set commit_docs true', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.commit_docs, true);
    assert.strictEqual(typeof config.commit_docs, 'boolean');
  });

  test('coerces false to boolean', () => {
    const result = runGsdTools('config-set commit_docs false', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.commit_docs, false);
    assert.strictEqual(typeof config.commit_docs, 'boolean');
  });

  test('coerces numeric strings to numbers', () => {
    const result = runGsdTools('config-set granularity 42', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.granularity, 42);
    assert.strictEqual(typeof config.granularity, 'number');
  });

  test('preserves plain strings', () => {
    const result = runGsdTools('config-set model_profile hello', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.model_profile, 'hello');
    assert.strictEqual(typeof config.model_profile, 'string');
  });

  test('sets nested values via dot-notation', () => {
    const result = runGsdTools('config-set workflow.research false', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.research, false);
  });

  test('auto-creates nested objects for dot-notation', () => {
    // Start with empty config
    writeConfig(tmpDir, {});

    const result = runGsdTools('config-set workflow.research false', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.research, false);
    assert.strictEqual(typeof config.workflow, 'object');
  });

  test('rejects unknown config keys', () => {
    const result = runGsdTools('config-set workflow.nyquist_validation_enabled false', tmpDir);
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Unknown config key'),
      `Expected "Unknown config key" in error: ${result.error}`
    );
  });

  test('errors when no key path provided', () => {
    const result = runGsdTools('config-set', tmpDir);
    assert.strictEqual(result.success, false);
  });

  test('rejects known invalid nyquist alias keys with a suggestion', () => {
    const result = runGsdTools('config-set workflow.nyquist_validation_enabled false', tmpDir);
    assert.strictEqual(result.success, false);
    assert.match(result.error, /Unknown config key: workflow\.nyquist_validation_enabled/);
    assert.match(result.error, /workflow\.nyquist_validation/);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.workflow.nyquist_validation_enabled, undefined);
    assert.strictEqual(config.workflow.nyquist_validation, true);
  });
});

// ─── Phase 13 git config keys (GIT-01) ───────────────────────────────────────

describe('Phase 13 git config keys (GIT-01)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create initial config
    runGsdTools('config-ensure-section', tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('GIT-01 Test 1: config-set git.target_branch develop succeeds and writes git.target_branch', () => {
    const result = runGsdTools('config-set git.target_branch develop', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.git.target_branch, 'develop');
  });

  test('GIT-01 Test 2: config-set git.auto_push true succeeds and writes git.auto_push as boolean', () => {
    const result = runGsdTools('config-set git.auto_push true', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.git.auto_push, true);
    assert.strictEqual(typeof config.git.auto_push, 'boolean');
  });

  test('GIT-01 Test 3: config-set git.remote upstream succeeds and writes git.remote', () => {
    const result = runGsdTools('config-set git.remote upstream', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.git.remote, 'upstream');
  });

  test('GIT-01 Test 4: config-set git.review_branch_template succeeds and writes template string', () => {
    const result = runGsdTools(['config-set', 'git.review_branch_template', '{type}/{slug}'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.git.review_branch_template, '{type}/{slug}');
  });

  test('GIT-01 Test 5: config-set git.pr_draft false succeeds and writes git.pr_draft as boolean', () => {
    const result = runGsdTools('config-set git.pr_draft false', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.git.pr_draft, false);
    assert.strictEqual(typeof config.git.pr_draft, 'boolean');
  });

  test('GIT-01 Test 6: config-set git.platform gitlab succeeds and writes git.platform', () => {
    const result = runGsdTools('config-set git.platform gitlab', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.git.platform, 'gitlab');
  });

  test('GIT-01 Test 7: config-set git.type_aliases custom succeeds (key is registered)', () => {
    const result = runGsdTools('config-set git.type_aliases custom', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
  });

  test('GIT-01 Test 8: init execute-phase JSON includes target_branch, auto_push, remote, review_branch_template, pr_draft, platform with defaults', () => {
    const fs = require('fs');
    const path = require('path');

    // Create a ROADMAP.md with Phase 13 entry
    const roadmapContent = `# Milestone v2.0\n\n## Phase 13: Git Branching And Collaboration\n\n**Goal:** Add git branching support\n**Requirements:** GIT-01\n`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), roadmapContent, 'utf-8');

    // Create the phase directory and a dummy plan
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '13-git-branching-and-collaboration'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '13-git-branching-and-collaboration', '13-01-PLAN.md'),
      '---\nphase: 13\nplan: 01\n---\n\n# Plan\n',
      'utf-8'
    );

    const result = runGsdTools('init execute-phase 13', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok('target_branch' in output, 'output should include target_branch');
    assert.ok('auto_push' in output, 'output should include auto_push');
    assert.ok('remote' in output, 'output should include remote');
    assert.ok('review_branch_template' in output, 'output should include review_branch_template');
    assert.ok('pr_draft' in output, 'output should include pr_draft');
    assert.ok('platform' in output, 'output should include platform');
  });

  test('GIT-01 Test 9: loadConfig returns target_branch: "main" by default (verified via init output)', () => {
    const fs = require('fs');
    const path = require('path');

    const roadmapContent = `# Milestone v2.0\n\n## Phase 13: Git Branching And Collaboration\n\n**Goal:** Add git branching support\n**Requirements:** GIT-01\n`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), roadmapContent, 'utf-8');

    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '13-git-branching-and-collaboration'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '13-git-branching-and-collaboration', '13-01-PLAN.md'),
      '---\nphase: 13\nplan: 01\n---\n\n# Plan\n',
      'utf-8'
    );

    const result = runGsdTools('init execute-phase 13', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.target_branch, 'main', 'default target_branch should be "main"');
  });

  test('GIT-01 Test 10: loadConfig returns auto_push: false by default (verified via init output)', () => {
    const fs = require('fs');
    const path = require('path');

    const roadmapContent = `# Milestone v2.0\n\n## Phase 13: Git Branching And Collaboration\n\n**Goal:** Add git branching support\n**Requirements:** GIT-01\n`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), roadmapContent, 'utf-8');

    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '13-git-branching-and-collaboration'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '13-git-branching-and-collaboration', '13-01-PLAN.md'),
      '---\nphase: 13\nplan: 01\n---\n\n# Plan\n',
      'utf-8'
    );

    const result = runGsdTools('init execute-phase 13', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.auto_push, false, 'default auto_push should be false');
  });

  test('GIT-01 Test 11: After config-set git.target_branch develop, init execute-phase returns target_branch: "develop"', () => {
    const fs = require('fs');
    const path = require('path');

    const roadmapContent = `# Milestone v2.0\n\n## Phase 13: Git Branching And Collaboration\n\n**Goal:** Add git branching support\n**Requirements:** GIT-01\n`;
    fs.writeFileSync(path.join(tmpDir, '.planning', 'ROADMAP.md'), roadmapContent, 'utf-8');

    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '13-git-branching-and-collaboration'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'phases', '13-git-branching-and-collaboration', '13-01-PLAN.md'),
      '---\nphase: 13\nplan: 01\n---\n\n# Plan\n',
      'utf-8'
    );

    // First set the target branch
    const setResult = runGsdTools('config-set git.target_branch develop', tmpDir);
    assert.ok(setResult.success, `config-set failed: ${setResult.error}`);

    // Then verify init execute-phase returns the updated value
    const initResult = runGsdTools('init execute-phase 13', tmpDir);
    assert.ok(initResult.success, `init failed: ${initResult.error}`);

    const output = JSON.parse(initResult.output);
    assert.strictEqual(output.target_branch, 'develop', 'target_branch should be "develop" after config-set');
  });
});

// ─── config-get ──────────────────────────────────────────────────────────────

describe('config-get command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create config with known values
    runGsdTools('config-ensure-section', tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('gets a top-level value', () => {
    const result = runGsdTools('config-get model_profile', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output, 'balanced');
  });

  test('gets a nested value via dot-notation', () => {
    const result = runGsdTools('config-get workflow.research', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output, true);
  });

  test('errors for nonexistent key', () => {
    const result = runGsdTools('config-get nonexistent_key', tmpDir);
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Key not found'),
      `Expected "Key not found" in error: ${result.error}`
    );
  });

  test('errors for deeply nested nonexistent key', () => {
    const result = runGsdTools('config-get workflow.nonexistent', tmpDir);
    assert.strictEqual(result.success, false);
    assert.ok(
      result.error.includes('Key not found'),
      `Expected "Key not found" in error: ${result.error}`
    );
  });

  test('errors when config.json does not exist', () => {
    const emptyTmpDir = createTempProject();
    try {
      const result = runGsdTools('config-get model_profile', emptyTmpDir);
      assert.strictEqual(result.success, false);
      assert.ok(
        result.error.includes('No config.json'),
        `Expected "No config.json" in error: ${result.error}`
      );
    } finally {
      cleanup(emptyTmpDir);
    }
  });

  test('errors when no key path provided', () => {
    const result = runGsdTools('config-get', tmpDir);
    assert.strictEqual(result.success, false);
  });
});

// ─── Phase 14 commit and versioning config keys (COMM-01) ────────────────────

describe('git commit and versioning config keys', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runGsdTools('config-ensure-section', tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('config-set git.commit_format conventional succeeds', () => {
    const result = runGsdTools('config-set git.commit_format conventional', tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);
    const config = readConfig(tmpDir);
    assert.strictEqual(config.git.commit_format, 'conventional');
  });

  test('config-set git.commit_template with custom string', () => {
    const result = runGsdTools(['config-set', 'git.commit_template', '{type}: {description}'], tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);
    const config = readConfig(tmpDir);
    assert.strictEqual(config.git.commit_template, '{type}: {description}');
  });

  test('config-set git.versioning_scheme semver succeeds', () => {
    const result = runGsdTools('config-set git.versioning_scheme semver', tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);
    const config = readConfig(tmpDir);
    assert.strictEqual(config.git.versioning_scheme, 'semver');
  });

  test('config-get git.commit_format returns set value', () => {
    writeConfig(tmpDir, { git: { commit_format: 'issue-first' } });
    const result = runGsdTools('config-get git.commit_format', tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);
    assert.strictEqual(JSON.parse(result.output), 'issue-first');
  });
});

// ─── Phase 21-03 issue_tracker.verify_label config key (VERIFY-01) ───────────

describe('issue_tracker.verify_label config key (VERIFY-01)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    runGsdTools('config-ensure-section', tmpDir);
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Test 9: config-set issue_tracker.verify_label 'reviewed' succeeds
  test('VERIFY-01 config-set issue_tracker.verify_label reviewed succeeds', () => {
    const result = runGsdTools('config-set issue_tracker.verify_label reviewed', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.issue_tracker.verify_label, 'reviewed');
  });

  test('VERIFY-01 config-set issue_tracker.verify_label needs-verification succeeds', () => {
    const result = runGsdTools(['config-set', 'issue_tracker.verify_label', 'needs-verification'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const config = readConfig(tmpDir);
    assert.strictEqual(config.issue_tracker.verify_label, 'needs-verification');
  });
});
