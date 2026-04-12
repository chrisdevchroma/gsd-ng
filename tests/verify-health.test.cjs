/**
 * GSD Tools Tests - Validate Health Command
 *
 * Comprehensive tests for validate-health covering all 8 health checks
 * and the repair path.
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup, cleanupSubdir } = require('./helpers.cjs');

// ─── Helpers for setting up minimal valid projects ────────────────────────────

function writeMinimalRoadmap(tmpDir, phases = ['1']) {
  const lines = phases.map(n => `### Phase ${n}: Phase ${n} Description`).join('\n');
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'ROADMAP.md'),
    `# Roadmap\n\n${lines}\n`
  );
}

function writeMinimalProjectMd(tmpDir, sections = ['## What This Is', '## Core Value', '## Requirements']) {
  const content = sections.map(s => `${s}\n\nContent here.\n`).join('\n');
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'PROJECT.md'),
    `# Project\n\n${content}`
  );
}

function writeMinimalStateMd(tmpDir, content) {
  const defaultContent = content || `# Session State\n\n## Current Position\n\nPhase: 1\n`;
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'STATE.md'),
    defaultContent
  );
}

function writeValidConfigJson(tmpDir) {
  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'config.json'),
    JSON.stringify({ model_profile: 'balanced', commit_docs: true }, null, 2)
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// validate health command — all 8 checks
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ─── Check 1: .planning/ exists ───────────────────────────────────────────

  test("returns 'broken' when .planning directory is missing", () => {
    // createTempProject creates .planning/phases — remove it entirely
    cleanupSubdir(tmpDir, '.planning');

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'broken', 'should be broken');
    assert.ok(
      output.errors.some(e => e.code === 'E001'),
      `Expected E001 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  // ─── Check 2: PROJECT.md exists and has required sections ─────────────────

  test('warns when PROJECT.md is missing', () => {
    // No PROJECT.md in .planning
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // Create valid phase dir so no W007
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some(e => e.code === 'E002'),
      `Expected E002 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  test('warns when PROJECT.md missing required sections', () => {
    // PROJECT.md missing "## Core Value" section
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'PROJECT.md'),
      '# Project\n\n## What This Is\n\nFoo\n\n## Requirements\n\nBar\n'
    );
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w001s = output.warnings.filter(w => w.code === 'W001');
    assert.ok(w001s.length > 0, `Expected W001 warnings: ${JSON.stringify(output.warnings)}`);
    assert.ok(
      w001s.some(w => w.message.includes('## Core Value')),
      `Expected W001 mentioning "## Core Value": ${JSON.stringify(w001s)}`
    );
  });

  test('passes when PROJECT.md has all required sections', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.errors.some(e => e.code === 'E002'),
      `Should not have E002: ${JSON.stringify(output.errors)}`
    );
    assert.ok(
      !output.warnings.some(w => w.code === 'W001'),
      `Should not have W001: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 3: ROADMAP.md exists ───────────────────────────────────────────

  test('errors when ROADMAP.md is missing', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // No ROADMAP.md

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some(e => e.code === 'E003'),
      `Expected E003 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  // ─── Check 4: STATE.md exists and references valid phases ─────────────────

  test('errors when STATE.md is missing with repairable true', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    // No STATE.md

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const e004 = output.errors.find(e => e.code === 'E004');
    assert.ok(e004, `Expected E004 in errors: ${JSON.stringify(output.errors)}`);
    assert.strictEqual(e004.repairable, true, 'E004 should be repairable');
  });

  test('warns when STATE.md references nonexistent phase', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeValidConfigJson(tmpDir);
    // STATE.md mentions Phase 99 but only 01-a dir exists
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      '# Session State\n\nPhase 99 is the current phase.\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W002'),
      `Expected W002 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 5: config.json valid JSON + valid schema ───────────────────────

  test('warns when config.json is missing with repairable true', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    // No config.json

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w003 = output.warnings.find(w => w.code === 'W003');
    assert.ok(w003, `Expected W003 in warnings: ${JSON.stringify(output.warnings)}`);
    assert.strictEqual(w003.repairable, true, 'W003 should be repairable');
  });

  test('errors when config.json has invalid JSON', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      '{broken json'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some(e => e.code === 'E005'),
      `Expected E005 in errors: ${JSON.stringify(output.errors)}`
    );
  });

  test('warns when config.json has invalid model_profile', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'invalid' })
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W004'),
      `Expected W004 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 6: Phase directory naming (NN-name format) ─────────────────────

  test('warns about incorrectly named phase directories', () => {
    writeMinimalProjectMd(tmpDir);
    // Roadmap with no phases to avoid W006
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases yet.\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase references.\n');
    writeValidConfigJson(tmpDir);
    // Create a badly named dir
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', 'bad_name'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W005'),
      `Expected W005 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 7: Orphaned plans (PLAN without SUMMARY) ───────────────────────

  test('reports orphaned plans (PLAN without SUMMARY) as info', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    writeValidConfigJson(tmpDir);
    // Create 01-test phase dir with a PLAN but no matching SUMMARY
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    // No 01-01-SUMMARY.md

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.info.some(i => i.code === 'I001'),
      `Expected I001 in info: ${JSON.stringify(output.info)}`
    );
  });

  // ─── Check 8: Consistency (roadmap/disk sync) ─────────────────────────────

  test('warns about phase in ROADMAP but not on disk', () => {
    writeMinimalProjectMd(tmpDir);
    // ROADMAP mentions Phase 5 but no 05-xxx dir
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 5: Future Phase\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase refs.\n');
    writeValidConfigJson(tmpDir);
    // No phase dirs

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W006'),
      `Expected W006 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('warns about phase on disk but not in ROADMAP', () => {
    writeMinimalProjectMd(tmpDir);
    // ROADMAP has no phases
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\nNo phases listed.\n'
    );
    writeMinimalStateMd(tmpDir, '# Session State\n\nNo phase refs.\n');
    writeValidConfigJson(tmpDir);
    // Orphan phase dir not in ROADMAP
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '99-orphan'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W007'),
      `Expected W007 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 5b: Nyquist validation key presence (W008) ─────────────────────

  test('detects W008 when workflow.nyquist_validation absent from config', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Config with workflow section but WITHOUT nyquist_validation key
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true } }, null, 2)
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W008'),
      `Expected W008 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('does not emit W008 when nyquist_validation is explicitly set', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Config with workflow.nyquist_validation explicitly set
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true, nyquist_validation: true } }, null, 2)
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W008'),
      `Should not have W008: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Check 7b: Nyquist VALIDATION.md consistency (W009) ──────────────────

  test('detects W009 when RESEARCH.md has Validation Architecture but no VALIDATION.md', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create phase dir with RESEARCH.md containing Validation Architecture
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Validation Architecture\n\nSome validation content.\n'
    );
    // No VALIDATION.md

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W009'),
      `Expected W009 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('does not emit W009 when VALIDATION.md exists alongside RESEARCH.md', () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create phase dir with both RESEARCH.md and VALIDATION.md
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-setup');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-RESEARCH.md'),
      '# Research\n\n## Validation Architecture\n\nSome validation content.\n'
    );
    fs.writeFileSync(
      path.join(phaseDir, '01-VALIDATION.md'),
      '# Validation\n\nValidation content.\n'
    );

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W009'),
      `Should not have W009: ${JSON.stringify(output.warnings)}`
    );
  });

  // ─── Overall status ────────────────────────────────────────────────────────

  test("returns 'healthy' when all checks pass", () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    // Create CLAUDE.md so W010 doesn't fire
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Project\n\nProject instructions.\n');
    // Create valid phase dir matching ROADMAP
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-a');
    fs.mkdirSync(phaseDir, { recursive: true });
    // Add PLAN+SUMMARY so no I001
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary\n');

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'healthy', `Expected healthy, got ${output.status}. Errors: ${JSON.stringify(output.errors)}, Warnings: ${JSON.stringify(output.warnings)}`);
    assert.deepStrictEqual(output.errors, [], 'should have no errors');
    assert.deepStrictEqual(output.warnings, [], 'should have no warnings');
  });

  test("returns 'degraded' when only warnings exist", () => {
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir);
    // No config.json → W003 (warning, not error)
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'degraded', `Expected degraded, got ${output.status}`);
    assert.strictEqual(output.errors.length, 0, 'should have no errors');
    assert.ok(output.warnings.length > 0, 'should have warnings');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health --repair command
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health --repair command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Set up base project with ROADMAP and PROJECT.md so repairs are triggered
    // (E001, E003 are not repairable so we always need .planning/ and ROADMAP.md)
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('creates config.json with defaults when missing', () => {
    // STATE.md present so no STATE repair; no config.json
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Ensure no config.json
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed array: ${JSON.stringify(output)}`
    );
    const createAction = output.repairs_performed.find(r => r.action === 'createConfig');
    assert.ok(createAction, `Expected createConfig action: ${JSON.stringify(output.repairs_performed)}`);
    assert.strictEqual(createAction.success, true, 'createConfig should succeed');

    // Verify config.json now exists on disk with valid JSON and balanced profile
    assert.ok(fs.existsSync(configPath), 'config.json should now exist on disk');
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(diskConfig.model_profile, 'balanced', 'default model_profile should be balanced');
    // Verify nested workflow structure matches config.cjs canonical format
    assert.ok(diskConfig.workflow, 'config should have nested workflow object');
    assert.strictEqual(diskConfig.workflow.research, true, 'workflow.research should default to true');
    assert.strictEqual(diskConfig.workflow.plan_check, true, 'workflow.plan_check should default to true');
    assert.strictEqual(diskConfig.workflow.verifier, true, 'workflow.verifier should default to true');
    assert.strictEqual(diskConfig.workflow.nyquist_validation, true, 'workflow.nyquist_validation should default to true');
    // Verify branch templates are present
    assert.strictEqual(diskConfig.phase_branch_template, 'gsd/phase-{phase}-{slug}');
    assert.strictEqual(diskConfig.milestone_branch_template, 'gsd/{milestone}-{slug}');
  });

  test('resets config.json when JSON is invalid', () => {
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, '{broken json');

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed: ${JSON.stringify(output)}`
    );
    const resetAction = output.repairs_performed.find(r => r.action === 'resetConfig');
    assert.ok(resetAction, `Expected resetConfig action: ${JSON.stringify(output.repairs_performed)}`);

    // Verify config.json is now valid JSON with correct nested structure
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.ok(typeof diskConfig === 'object', 'config.json should be valid JSON after repair');
    assert.ok(diskConfig.workflow, 'reset config should have nested workflow object');
    assert.strictEqual(diskConfig.workflow.research, true, 'workflow.research should be true after reset');
  });

  test('regenerates STATE.md when missing', () => {
    writeValidConfigJson(tmpDir);
    // No STATE.md
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed: ${JSON.stringify(output)}`
    );
    const regenerateAction = output.repairs_performed.find(r => r.action === 'regenerateState');
    assert.ok(regenerateAction, `Expected regenerateState action: ${JSON.stringify(output.repairs_performed)}`);
    assert.strictEqual(regenerateAction.success, true, 'regenerateState should succeed');

    // Verify STATE.md now exists and contains "# Session State"
    assert.ok(fs.existsSync(statePath), 'STATE.md should now exist on disk');
    const stateContent = fs.readFileSync(statePath, 'utf-8');
    assert.ok(stateContent.includes('# Session State'), 'regenerated STATE.md should contain "# Session State"');
  });

  test('backs up existing STATE.md before regenerating', () => {
    writeValidConfigJson(tmpDir);
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    const originalContent = '# Session State\n\nOriginal content here.\n';
    fs.writeFileSync(statePath, originalContent);

    // Make STATE.md reference a nonexistent phase so repair is triggered
    fs.writeFileSync(
      statePath,
      '# Session State\n\nPhase 99 is current.\n'
    );

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed: ${JSON.stringify(output)}`
    );

    // Verify a .bak- file exists alongside STATE.md
    const planningDir = path.join(tmpDir, '.planning');
    const planningFiles = fs.readdirSync(planningDir);
    const backupFile = planningFiles.find(f => f.startsWith('STATE.md.bak-'));
    assert.ok(backupFile, `Expected a STATE.md.bak- file. Found files: ${planningFiles.join(', ')}`);

    // Verify backup contains the original content
    const backupContent = fs.readFileSync(path.join(planningDir, backupFile), 'utf-8');
    assert.ok(backupContent.includes('Phase 99'), 'backup should contain the original STATE.md content');
  });

  test('adds nyquist_validation key to config.json via addNyquistKey repair', () => {
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    // Config with workflow section but missing nyquist_validation
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    fs.writeFileSync(
      configPath,
      JSON.stringify({ model_profile: 'balanced', workflow: { research: true } }, null, 2)
    );

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      Array.isArray(output.repairs_performed),
      `Expected repairs_performed array: ${JSON.stringify(output)}`
    );
    const addKeyAction = output.repairs_performed.find(r => r.action === 'addNyquistKey');
    assert.ok(addKeyAction, `Expected addNyquistKey action: ${JSON.stringify(output.repairs_performed)}`);
    assert.strictEqual(addKeyAction.success, true, 'addNyquistKey should succeed');

    // Read config.json and verify workflow.nyquist_validation is true
    const diskConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    assert.strictEqual(diskConfig.workflow.nyquist_validation, true, 'nyquist_validation should be true');
  });

  test('reports repairable_count correctly', () => {
    // No config.json (W003, repairable=true) and no STATE.md (E004, repairable=true)
    const configPath = path.join(tmpDir, '.planning', 'config.json');
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
    const statePath = path.join(tmpDir, '.planning', 'STATE.md');
    if (fs.existsSync(statePath)) fs.unlinkSync(statePath);

    // Run WITHOUT --repair to just check repairable_count
    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.repairable_count >= 2,
      `Expected repairable_count >= 2, got ${output.repairable_count}. Full output: ${JSON.stringify(output)}`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health — memory checks (W010-W014)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — memory checks (W010-W014)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Set up a minimal valid project so only memory checks fire
    writeMinimalProjectMd(tmpDir);
    writeMinimalRoadmap(tmpDir, ['1']);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ─── Helper to write a memory file ────────────────────────────────────────

  function writeMemoryFile(tmpDir, filename, description = 'Test memory', type = 'feedback') {
    const memDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(
      path.join(memDir, filename),
      `---\nname: Test\ndescription: ${description}\ntype: ${type}\n---\n\nContent.\n`
    );
    return memDir;
  }

  function writeCLAUDEmd(tmpDir, content) {
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), content);
  }

  // ─── W010: CLAUDE.md missing when .planning/ exists ───────────────────────

  test('W010 fires when .planning/ exists but CLAUDE.md does not exist', () => {
    // No CLAUDE.md, no memory dir — just .planning/ existing triggers W010
    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W010'),
      `Expected W010 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W010 does not fire when CLAUDE.md exists', () => {
    writeCLAUDEmd(tmpDir, '# Project\n\nSome content.\n');

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W010'),
      `Should not have W010: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W010 repair creates CLAUDE.md with Memories section', () => {
    writeMemoryFile(tmpDir, 'test_feedback.md', 'A test feedback entry');
    // No CLAUDE.md

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const writeCLAUDE = output.repairs_performed && output.repairs_performed.find(r => r.action === 'writeCLAUDEmd');
    assert.ok(writeCLAUDE, `Expected writeCLAUDEmd repair action: ${JSON.stringify(output)}`);
    assert.strictEqual(writeCLAUDE.success, true, 'writeCLAUDEmd should succeed');

    // Verify CLAUDE.md now exists and has Memories section
    const claudePath = path.join(tmpDir, 'CLAUDE.md');
    assert.ok(fs.existsSync(claudePath), 'CLAUDE.md should exist after repair');
    const content = fs.readFileSync(claudePath, 'utf-8');
    assert.ok(content.includes('## Memories'), 'CLAUDE.md should contain ## Memories section');
    assert.ok(content.includes('test_feedback.md'), 'CLAUDE.md should reference the memory file');
  });

  // ─── W011: Orphaned memory files not referenced in CLAUDE.md ──────────────

  test('W011 fires when .claude/memory/ has files not referenced in CLAUDE.md', () => {
    writeMemoryFile(tmpDir, 'unreferenced.md', 'Unreferenced memory');
    // CLAUDE.md exists but does not reference unreferenced.md
    writeCLAUDEmd(tmpDir, '# Project\n\n## Memories\n\nRead `.claude/memory/` for context.\n');

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W011'),
      `Expected W011 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W011 does not fire when all memory files are referenced in CLAUDE.md', () => {
    writeMemoryFile(tmpDir, 'feedback_example.md', 'Example feedback');
    writeCLAUDEmd(
      tmpDir,
      '# Project\n\n## Memories\n\n- [.claude/memory/feedback_example.md](.claude/memory/feedback_example.md) — Example feedback\n'
    );

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W011'),
      `Should not have W011: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W011 repair adds missing memory references to CLAUDE.md', () => {
    writeMemoryFile(tmpDir, 'feedback_new.md', 'New feedback file');
    // CLAUDE.md Memories section missing the reference
    writeCLAUDEmd(tmpDir, '# Project\n\n## Memories\n\nRead `.claude/memory/` for context.\n\nNo entries yet.\n');

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const syncAction = output.repairs_performed && output.repairs_performed.find(r => r.action === 'syncCLAUDEmdMemories');
    assert.ok(syncAction, `Expected syncCLAUDEmdMemories repair: ${JSON.stringify(output)}`);
    assert.strictEqual(syncAction.success, true, 'syncCLAUDEmdMemories should succeed');

    // Verify CLAUDE.md now references the memory file
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(content.includes('feedback_new.md'), 'CLAUDE.md should reference the new memory file after repair');
  });

  // ─── W012: Stale references in CLAUDE.md ──────────────────────────────────

  test('W012 fires when CLAUDE.md references a memory file that does not exist on disk', () => {
    const memDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    // CLAUDE.md references a nonexistent file
    writeCLAUDEmd(
      tmpDir,
      '# Project\n\n## Memories\n\n- [.claude/memory/nonexistent.md](.claude/memory/nonexistent.md) — Gone\n'
    );

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W012'),
      `Expected W012 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W012 does not fire when all CLAUDE.md references exist on disk', () => {
    writeMemoryFile(tmpDir, 'existing.md', 'Existing memory file');
    writeCLAUDEmd(
      tmpDir,
      '# Project\n\n## Memories\n\n- [.claude/memory/existing.md](.claude/memory/existing.md) — Exists\n'
    );

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W012'),
      `Should not have W012: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W012 repair removes stale references from CLAUDE.md', () => {
    const memDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    // CLAUDE.md references a nonexistent file (stale)
    writeCLAUDEmd(
      tmpDir,
      '# Project\n\n## Memories\n\n- [.claude/memory/stale.md](.claude/memory/stale.md) — Stale reference\n'
    );

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const syncAction = output.repairs_performed && output.repairs_performed.find(r => r.action === 'syncCLAUDEmdMemories');
    assert.ok(syncAction, `Expected syncCLAUDEmdMemories repair: ${JSON.stringify(output)}`);
    assert.strictEqual(syncAction.success, true, 'syncCLAUDEmdMemories should succeed');

    // Verify CLAUDE.md no longer references stale.md
    const content = fs.readFileSync(path.join(tmpDir, 'CLAUDE.md'), 'utf-8');
    assert.ok(!content.includes('stale.md'), 'CLAUDE.md should not reference stale.md after repair');
  });

  // ─── W013: MEMORY.md drift ─────────────────────────────────────────────────

  test('W013 fires when MEMORY.md is out of sync with .claude/memory/ contents', () => {
    writeMemoryFile(tmpDir, 'feedback_a.md', 'Feedback entry A');
    const memDir = path.join(tmpDir, '.claude', 'memory');
    // Write a MEMORY.md that does NOT match what generateMemoryMd would produce
    fs.writeFileSync(
      path.join(memDir, 'MEMORY.md'),
      '# Memory Index\n\nThis is stale content that does not match the files.\n'
    );
    writeCLAUDEmd(
      tmpDir,
      '# Project\n\n## Memories\n\n- [.claude/memory/feedback_a.md](.claude/memory/feedback_a.md) — Feedback entry A\n'
    );

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W013'),
      `Expected W013 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W013 repair regenerates MEMORY.md to match current .claude/memory/ contents', () => {
    writeMemoryFile(tmpDir, 'feedback_b.md', 'Feedback entry B');
    const memDir = path.join(tmpDir, '.claude', 'memory');
    // Stale MEMORY.md
    fs.writeFileSync(
      path.join(memDir, 'MEMORY.md'),
      '# Memory Index\n\nStale.\n'
    );
    writeCLAUDEmd(
      tmpDir,
      '# Project\n\n## Memories\n\n- [.claude/memory/feedback_b.md](.claude/memory/feedback_b.md) — Feedback entry B\n'
    );

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const syncAction = output.repairs_performed && output.repairs_performed.find(r => r.action === 'syncMemoryMd');
    assert.ok(syncAction, `Expected syncMemoryMd repair: ${JSON.stringify(output)}`);
    assert.strictEqual(syncAction.success, true, 'syncMemoryMd should succeed');

    // Verify MEMORY.md now contains the memory file reference
    const memoryMdContent = fs.readFileSync(path.join(memDir, 'MEMORY.md'), 'utf-8');
    assert.ok(memoryMdContent.includes('feedback_b.md'), 'MEMORY.md should contain the memory file reference after repair');
  });

  // ─── W014: Topology drift (advisory-only) ─────────────────────────────────

  test('W014 fires when .gitmodules exists but no structural memory is seeded', () => {
    const memDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    // Write a memory file without "boundary" or "subdirectory" content
    fs.writeFileSync(
      path.join(memDir, 'feedback_x.md'),
      '---\nname: Test\ndescription: Generic feedback\ntype: feedback\n---\n\nThis is generic content.\n'
    );
    writeCLAUDEmd(
      tmpDir,
      '# Project\n\n## Memories\n\n- [.claude/memory/feedback_x.md](.claude/memory/feedback_x.md) — Generic feedback\n'
    );
    // Create .gitmodules to signal submodule topology
    fs.writeFileSync(path.join(tmpDir, '.gitmodules'), '[submodule "sub"]\n  path = sub\n  url = https://example.com/sub\n');

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some(w => w.code === 'W014'),
      `Expected W014 in warnings: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W014 does not fire for standalone workspaces (no .gitmodules, no workspaces)', () => {
    const memDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    writeCLAUDEmd(tmpDir, '# Project\n\n## Memories\n\nNo entries.\n');
    // No .gitmodules, no pnpm-workspace.yaml, no workspaces in package.json

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W014'),
      `Should not have W014: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W014 is NOT repairable (repairable=false)', () => {
    const memDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(
      path.join(memDir, 'feedback_x.md'),
      '---\nname: Test\ndescription: Generic\ntype: feedback\n---\n\nGeneric.\n'
    );
    writeCLAUDEmd(
      tmpDir,
      '# Project\n\n## Memories\n\n- [.claude/memory/feedback_x.md](.claude/memory/feedback_x.md) — Generic\n'
    );
    fs.writeFileSync(path.join(tmpDir, '.gitmodules'), '[submodule "sub"]\n  path = sub\n  url = https://example.com/sub\n');

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const w014 = output.warnings.find(w => w.code === 'W014');
    assert.ok(w014, `Expected W014 in warnings: ${JSON.stringify(output.warnings)}`);
    assert.strictEqual(w014.repairable, false, 'W014 should not be repairable');
  });

  // ─── Gating: W011-W014 skipped when CLAUDE.md does not exist ─────────────

  test('W011-W014 are skipped when CLAUDE.md does not exist (only W010 fires)', () => {
    const memDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memDir, { recursive: true });
    fs.writeFileSync(
      path.join(memDir, 'feedback_x.md'),
      '---\nname: Test\ndescription: Generic\ntype: feedback\n---\n\nGeneric.\n'
    );
    fs.writeFileSync(path.join(tmpDir, '.gitmodules'), '[submodule "sub"]\n  path = sub\n  url = https://example.com/sub\n');
    // No CLAUDE.md

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // W010 should fire
    assert.ok(
      output.warnings.some(w => w.code === 'W010'),
      `Expected W010: ${JSON.stringify(output.warnings)}`
    );
    // W011, W012, W013, W014 should NOT fire (gated on CLAUDE.md existence)
    // Note: W014 only gates on memoryDirExists, not claudeMdExists, so check W011/W012/W013
    assert.ok(
      !output.warnings.some(w => w.code === 'W011'),
      `Should not have W011 when CLAUDE.md missing: ${JSON.stringify(output.warnings)}`
    );
    assert.ok(
      !output.warnings.some(w => w.code === 'W012'),
      `Should not have W012 when CLAUDE.md missing: ${JSON.stringify(output.warnings)}`
    );
    assert.ok(
      !output.warnings.some(w => w.code === 'W013'),
      `Should not have W013 when CLAUDE.md missing: ${JSON.stringify(output.warnings)}`
    );
  });

  test('W011-W013 are skipped when .claude/memory/ directory does not exist', () => {
    writeCLAUDEmd(tmpDir, '# Project\n\nNo memories.\n');
    // No .claude/memory/ dir

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      !output.warnings.some(w => w.code === 'W011'),
      `Should not have W011 when memory dir missing: ${JSON.stringify(output.warnings)}`
    );
    assert.ok(
      !output.warnings.some(w => w.code === 'W012'),
      `Should not have W012 when memory dir missing: ${JSON.stringify(output.warnings)}`
    );
    assert.ok(
      !output.warnings.some(w => w.code === 'W013'),
      `Should not have W013 when memory dir missing: ${JSON.stringify(output.warnings)}`
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health — orphan detection checks (W015-W018)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — orphan detection checks (W015-W018)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Set up a minimal valid project so only orphan checks fire
    writeMinimalProjectMd(tmpDir);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Project\n\nInstructions.\n');
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ─── Helper: write a ROADMAP with specific phases ─────────────────────────

  function writeRoadmapWithPhases(tmpDir, phases) {
    // phases is array of { number, complete, name }
    const lines = phases.map(p => {
      const check = p.complete ? 'x' : ' ';
      return `- [${check}] **Phase ${p.number}: ${p.name || 'Phase ' + p.number}**`;
    });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n\n## Phases\n\n${lines.join('\n')}\n`
    );
  }

  // ─── Helper: write a pending todo with frontmatter ────────────────────────

  function writePendingTodo(tmpDir, filename, frontmatter) {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
    fs.writeFileSync(
      path.join(pendingDir, filename),
      `---\n${fmLines}\n---\n\nTodo content.\n`
    );
  }

  // ─── Helper: write a completed todo with frontmatter ─────────────────────

  function writeCompletedTodo(tmpDir, filename, frontmatter) {
    const completedDir = path.join(tmpDir, '.planning', 'todos', 'completed');
    fs.mkdirSync(completedDir, { recursive: true });
    const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
    fs.writeFileSync(
      path.join(completedDir, filename),
      `---\n${fmLines}\n---\n\nTodo content.\n`
    );
  }

  // ─── W017: Phase-linked todos without matching phase ──────────────────────

  test('W017 fires when pending todo references non-existent phase', () => {
    writeRoadmapWithPhases(tmpDir, [{ number: 1, complete: false }]);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    writePendingTodo(tmpDir, 'test-todo.md', { phase: 99 });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const w017 = parsed.warnings.find(w => w.code === 'W017');
    assert.ok(w017, `Expected W017 in warnings: ${JSON.stringify(parsed.warnings)}`);
    assert.ok(w017.message.includes('99'), `W017 message should mention phase 99: ${w017.message}`);
    assert.ok(w017.message.includes('phase') || w017.message.includes('Phase'), `W017 message should mention "phase": ${w017.message}`);
  });

  test('W018 fires when completed phase still has pending phase-linked todos', () => {
    writeRoadmapWithPhases(tmpDir, [
      { number: 5, complete: true, name: 'Done Phase' },
    ]);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '05-done'), { recursive: true });
    writePendingTodo(tmpDir, 'stale-todo.md', { phase: 5 });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const w018 = parsed.warnings.find(w => w.code === 'W018');
    assert.ok(w018, `Expected W018 in warnings: ${JSON.stringify(parsed.warnings)}`);
    assert.ok(w018.message.includes('5'), `W018 message should mention phase 5: ${w018.message}`);
  });

  test('W017 does NOT fire when todo phase exists in ROADMAP (not complete)', () => {
    writeRoadmapWithPhases(tmpDir, [
      { number: 1, complete: false, name: 'Active Phase' },
    ]);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-active'), { recursive: true });
    writePendingTodo(tmpDir, 'valid-todo.md', { phase: 1 });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.ok(
      !parsed.warnings.some(w => w.code === 'W017'),
      `Should not have W017 for valid phase ref: ${JSON.stringify(parsed.warnings)}`
    );
  });

  test('W015 and W016 are skipped when issue_tracker.platform is not configured', () => {
    writeRoadmapWithPhases(tmpDir, [{ number: 1, complete: false }]);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    // No issue_tracker.platform in config
    writeCompletedTodo(tmpDir, 'completed-with-ref.md', {
      external_ref: 'github:#42',
      completed: '2026-03-22',
    });
    writePendingTodo(tmpDir, 'pending-with-ref.md', {
      external_ref: 'github:#43',
    });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.ok(
      !parsed.warnings.some(w => w.code === 'W015'),
      `W015 should be skipped when no platform configured: ${JSON.stringify(parsed.warnings)}`
    );
    assert.ok(
      !parsed.warnings.some(w => w.code === 'W016'),
      `W016 should be skipped when no platform configured: ${JSON.stringify(parsed.warnings)}`
    );
  });

  test('W017 is repairable', () => {
    writeRoadmapWithPhases(tmpDir, [{ number: 1, complete: false }]);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), { recursive: true });
    writePendingTodo(tmpDir, 'orphan-todo.md', { phase: 99 });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const w017 = parsed.warnings.find(w => w.code === 'W017');
    assert.ok(w017, `Expected W017: ${JSON.stringify(parsed.warnings)}`);
    assert.strictEqual(w017.repairable, true, 'W017 should be repairable');
  });

  test('W018 is repairable', () => {
    writeRoadmapWithPhases(tmpDir, [
      { number: 3, complete: true, name: 'Complete Phase' },
    ]);
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-complete'), { recursive: true });
    writePendingTodo(tmpDir, 'linked-todo.md', { phase: 3 });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const w018 = parsed.warnings.find(w => w.code === 'W018');
    assert.ok(w018, `Expected W018: ${JSON.stringify(parsed.warnings)}`);
    assert.strictEqual(w018.repairable, true, 'W018 should be repairable');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate health — related link checks (W021-W022)
// ─────────────────────────────────────────────────────────────────────────────

describe('validate health — related link checks (W021-W022)', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    writeMinimalProjectMd(tmpDir);
    writeMinimalStateMd(tmpDir, '# Session State\n\nPhase 1 in progress.\n');
    writeValidConfigJson(tmpDir);
    fs.writeFileSync(path.join(tmpDir, 'CLAUDE.md'), '# Project\n\nInstructions.\n');
    // Write a minimal ROADMAP with one phase so W017/W018 don't interfere
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n## Phases\n\n- [ ] **Phase 1: Test Phase**\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-test'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ─── Helper: write a pending todo with frontmatter ────────────────────────

  function writePendingTodo(tmpDir, filename, frontmatter) {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
    fs.writeFileSync(
      path.join(pendingDir, filename),
      `---\n${fmLines}\n---\n\nTodo content.\n`
    );
  }

  // ─── Helper: write a completed todo with frontmatter ─────────────────────

  function writeCompletedTodo(tmpDir, filename, frontmatter) {
    const completedDir = path.join(tmpDir, '.planning', 'todos', 'completed');
    fs.mkdirSync(completedDir, { recursive: true });
    const fmLines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`).join('\n');
    fs.writeFileSync(
      path.join(completedDir, filename),
      `---\n${fmLines}\n---\n\nTodo content.\n`
    );
  }

  // ─── W021: broken related links ───────────────────────────────────────────

  test('W021 fires when pending todo related: references non-existent file', () => {
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[ghost.md]' });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const w021 = parsed.warnings.find(w => w.code === 'W021');
    assert.ok(w021, `Expected W021 in warnings: ${JSON.stringify(parsed.warnings)}`);
    assert.ok(w021.message.includes('ghost.md'), `W021 message should mention "ghost.md": ${w021.message}`);
    assert.ok(w021.message.includes('does not exist'), `W021 message should include "does not exist": ${w021.message}`);
    assert.strictEqual(w021.repairable, true, 'W021 should be repairable');
  });

  test('W021 does NOT fire when related: references file that exists in completed/', () => {
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[other.md]' });
    writeCompletedTodo(tmpDir, 'other.md', { completed: '2026-03-29' });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.ok(
      !parsed.warnings.some(w => w.code === 'W021'),
      `Should not have W021 when ref exists in completed/: ${JSON.stringify(parsed.warnings)}`
    );
  });

  test('W021 does NOT fire when related: references file that exists in pending/', () => {
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[todo-b.md]' });
    writePendingTodo(tmpDir, 'todo-b.md', { related: '[todo-a.md]' });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.ok(
      !parsed.warnings.some(w => w.code === 'W021'),
      `Should not have W021 when ref exists in pending/: ${JSON.stringify(parsed.warnings)}`
    );
  });

  test('W021 is repairable', () => {
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[ghost.md]' });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const w021 = parsed.warnings.find(w => w.code === 'W021');
    assert.ok(w021, `Expected W021: ${JSON.stringify(parsed.warnings)}`);
    assert.strictEqual(w021.repairable, true, 'W021 should be repairable');
  });

  // ─── W022: asymmetric related links ───────────────────────────────────────

  test('W022 fires when related: link is asymmetric (A references B but B does not reference A back)', () => {
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[todo-b.md]' });
    writePendingTodo(tmpDir, 'todo-b.md', { title: 'Todo B' });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const w022 = parsed.warnings.find(w => w.code === 'W022');
    assert.ok(w022, `Expected W022 in warnings: ${JSON.stringify(parsed.warnings)}`);
    assert.ok(
      w022.message.toLowerCase().includes('asymmetric'),
      `W022 message should include "asymmetric": ${w022.message}`
    );
    assert.ok(w022.message.includes('todo-a.md'), `W022 message should mention "todo-a.md": ${w022.message}`);
    assert.ok(w022.message.includes('todo-b.md'), `W022 message should mention "todo-b.md": ${w022.message}`);
    assert.strictEqual(w022.repairable, true, 'W022 should be repairable');
  });

  test('W022 does NOT fire when related: references are symmetric', () => {
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[todo-b.md]' });
    writePendingTodo(tmpDir, 'todo-b.md', { related: '[todo-a.md]' });

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.ok(
      !parsed.warnings.some(w => w.code === 'W022'),
      `Should not have W022 for symmetric related refs: ${JSON.stringify(parsed.warnings)}`
    );
  });

  test('W022 skips refs not in pending/ (no double-warn with W021 for missing files)', () => {
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[ghost.md]' });
    // ghost.md does not exist in pending/ or completed/

    const result = runGsdTools('validate health', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    // W021 should fire (broken link), W022 should NOT fire (ghost not in pending/)
    assert.ok(
      parsed.warnings.some(w => w.code === 'W021'),
      `Expected W021 for missing ref: ${JSON.stringify(parsed.warnings)}`
    );
    assert.ok(
      !parsed.warnings.some(w => w.code === 'W022'),
      `Should not have W022 when ref not in pending/: ${JSON.stringify(parsed.warnings)}`
    );
  });

  // ─── W021 repair: clearRelatedLink ────────────────────────────────────────

  test('W021 repair removes stale related: entry from pending todo file', () => {
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[ghost.md]' });

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const clearAction = parsed.repairs_performed && parsed.repairs_performed.find(a => a.action === 'clearRelatedLink');
    assert.ok(clearAction, `Expected clearRelatedLink in repairs_performed: ${JSON.stringify(parsed.repairs_performed)}`);
    assert.strictEqual(clearAction.success, true, 'clearRelatedLink should succeed');

    const { extractFrontmatter: efm } = require('../gsd-ng/bin/lib/frontmatter.cjs');
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'todos', 'pending', 'todo-a.md'), 'utf-8');
    const fm = efm(content);
    const relatedList = fm.related
      ? (Array.isArray(fm.related) ? fm.related : [fm.related])
      : [];
    assert.ok(!relatedList.includes('ghost.md'), `ghost.md should be removed from related: ${JSON.stringify(relatedList)}`);
  });

  test('W021 repair removes only the stale entry, preserving valid related refs', () => {
    // todo-a.md references ghost.md (stale) and todo-b.md (valid)
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[ghost.md, todo-b.md]' });
    writePendingTodo(tmpDir, 'todo-b.md', { related: '[todo-a.md]' });

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const { extractFrontmatter: efm } = require('../gsd-ng/bin/lib/frontmatter.cjs');
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'todos', 'pending', 'todo-a.md'), 'utf-8');
    const fm = efm(content);
    const relatedList = fm.related
      ? (Array.isArray(fm.related) ? fm.related : [fm.related])
      : [];
    assert.ok(!relatedList.includes('ghost.md'), `ghost.md should be removed: ${JSON.stringify(relatedList)}`);
    assert.ok(relatedList.includes('todo-b.md'), `todo-b.md should be preserved: ${JSON.stringify(relatedList)}`);
  });

  // ─── W022 repair: addBacklink ─────────────────────────────────────────────

  test('W022 repair adds missing backlink to target todo file', () => {
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[todo-b.md]' });
    writePendingTodo(tmpDir, 'todo-b.md', { title: 'Todo B' });

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    const backlinkAction = parsed.repairs_performed && parsed.repairs_performed.find(a => a.action === 'addBacklink');
    assert.ok(backlinkAction, `Expected addBacklink in repairs_performed: ${JSON.stringify(parsed.repairs_performed)}`);
    assert.strictEqual(backlinkAction.success, true, 'addBacklink should succeed');

    const { extractFrontmatter: efm } = require('../gsd-ng/bin/lib/frontmatter.cjs');
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'todos', 'pending', 'todo-b.md'), 'utf-8');
    const fm = efm(content);
    const relatedList = fm.related
      ? (Array.isArray(fm.related) ? fm.related : [fm.related])
      : [];
    assert.ok(relatedList.includes('todo-a.md'), `todo-b.md should now reference todo-a.md: ${JSON.stringify(relatedList)}`);
  });

  test('W022 repair preserves existing related refs when adding backlink', () => {
    // todo-a references todo-b (asymmetric), todo-b already references todo-c
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[todo-b.md]' });
    writePendingTodo(tmpDir, 'todo-b.md', { related: '[todo-c.md]' });
    writePendingTodo(tmpDir, 'todo-c.md', { related: '[todo-b.md]' });

    const result = runGsdTools('validate health --repair', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const { extractFrontmatter: efm } = require('../gsd-ng/bin/lib/frontmatter.cjs');
    const content = fs.readFileSync(path.join(tmpDir, '.planning', 'todos', 'pending', 'todo-b.md'), 'utf-8');
    const fm = efm(content);
    const relatedList = fm.related
      ? (Array.isArray(fm.related) ? fm.related : [fm.related])
      : [];
    assert.ok(relatedList.includes('todo-c.md'), `Existing ref todo-c.md should be preserved: ${JSON.stringify(relatedList)}`);
    assert.ok(relatedList.includes('todo-a.md'), `Backlink todo-a.md should be added: ${JSON.stringify(relatedList)}`);
  });

  test('W021 and W022 repairs are idempotent — re-running health shows no warnings', () => {
    // Setup: todo-a has stale ref, todo-a references todo-b (asymmetric)
    writePendingTodo(tmpDir, 'todo-a.md', { related: '[ghost.md, todo-b.md]' });
    writePendingTodo(tmpDir, 'todo-b.md', { title: 'Todo B' });

    // First run with repair
    const repairResult = runGsdTools('validate health --repair', tmpDir);
    assert.ok(repairResult.success, `Repair command failed: ${repairResult.error}`);

    // Second run without repair — should show no W021 or W022
    const checkResult = runGsdTools('validate health', tmpDir);
    assert.ok(checkResult.success, `Health check failed: ${checkResult.error}`);

    const parsed = JSON.parse(checkResult.output);
    const w021s = parsed.warnings.filter(w => w.code === 'W021');
    const w022s = parsed.warnings.filter(w => w.code === 'W022');
    assert.strictEqual(w021s.length, 0, `Should have no W021 warnings after repair: ${JSON.stringify(w021s)}`);
    assert.strictEqual(w022s.length, 0, `Should have no W022 warnings after repair: ${JSON.stringify(w022s)}`);
  });
});
