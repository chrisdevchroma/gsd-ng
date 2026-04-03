'use strict';
/**
 * E2E Smoke Test: install to execute lifecycle
 *
 * Validates the full install -> scaffold -> init plan-phase -> init execute-phase
 * lifecycle using the INSTALLED copy of gsd-tools.cjs (not the source copy).
 *
 * This catches integration bugs like positional argument issues that unit tests miss.
 */
const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { resolveTmpDir, createTempGitProject, cleanup } = require('../helpers.cjs');

const INSTALLER = path.resolve(__dirname, '..', '..', 'bin', 'install.js');

/** Run a command against the installed gsd-tools.cjs copy (not source). */
function runInstalled(args, cwd, installedToolsPath) {
  const result = spawnSync(process.execPath, [installedToolsPath, ...args], {
    cwd,
    encoding: 'utf-8',
    env: process.env,
    timeout: 30000,
  });
  return {
    success: result.status === 0,
    output: (result.stdout || '').trim(),
    error: (result.stderr || '').trim(),
  };
}

describe('E2E smoke test: install to execute', () => {
  let projectDir;
  let INSTALLED_TOOLS;

  before(() => {
    projectDir = createTempGitProject();
  });

  after(() => {
    if (projectDir) cleanup(projectDir);
  });

  test('E2E-01: install.js --local --runtime claude exits 0 and creates installed gsd-tools.cjs', () => {
    assert.ok(projectDir, 'projectDir must be set in before()');

    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        cwd: projectDir,
        encoding: 'utf8',
        timeout: 30000,
        env: process.env,
      }
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --local --runtime claude must exit 0\nstderr: ' + (result.stderr || '')
    );

    INSTALLED_TOOLS = path.join(projectDir, '.claude', 'gsd-ng', 'bin', 'gsd-tools.cjs');
    assert.ok(
      fs.existsSync(INSTALLED_TOOLS),
      'gsd-tools.cjs must exist at installed path: ' + INSTALLED_TOOLS
    );
  });

  test('E2E-02: installed gsd-tools.cjs responds to --help', () => {
    assert.ok(INSTALLED_TOOLS, 'INSTALLED_TOOLS must be set from E2E-01');

    const result = runInstalled(['--help'], projectDir, INSTALLED_TOOLS);
    assert.ok(
      result.success,
      'installed gsd-tools.cjs --help must exit 0\nstderr: ' + result.error
    );
    const combinedOutput = result.output + result.error;
    assert.ok(
      combinedOutput.includes('gsd-tools') || combinedOutput.includes('Usage') || combinedOutput.includes('usage'),
      'installed --help output must mention gsd-tools or Usage\noutput: ' + combinedOutput.slice(0, 500)
    );
  });

  test('E2E-03: scaffold phase-dir creates phase directory', () => {
    assert.ok(INSTALLED_TOOLS, 'INSTALLED_TOOLS must be set from E2E-01');

    // Write a minimal ROADMAP.md with a Phase 1 entry so scaffold can locate phase context
    const roadmapContent = [
      '# Roadmap',
      '',
      '## Milestone: test',
      '',
      '- [ ] **Phase 1: Test phase**',
      '',
      '## Phase Details',
      '',
      '### Phase 1: Test phase',
      '**Goal**: Test',
      '**Requirements**: NONE',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(projectDir, '.planning', 'ROADMAP.md'), roadmapContent);

    // Write a minimal STATE.md with current_phase: 1
    const stateContent = [
      '---',
      'gsd_state_version: 1.0',
      'milestone: test',
      'current_phase: 1',
      'current_plan: Not started',
      'status: testing',
      '---',
      '',
      '# Project State',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(projectDir, '.planning', 'STATE.md'), stateContent);

    const result = runInstalled(
      ['scaffold', 'phase-dir', '--phase', '1', '--name', 'test-phase'],
      projectDir,
      INSTALLED_TOOLS
    );
    assert.ok(
      result.success,
      'scaffold phase-dir must exit 0\nstderr: ' + result.error
    );

    const phaseDir = path.join(projectDir, '.planning', 'phases', '01-test-phase');
    assert.ok(
      fs.existsSync(phaseDir),
      'Phase directory must be created at: ' + phaseDir
    );
  });

  test('E2E-04: scaffold context creates CONTEXT.md template', () => {
    assert.ok(INSTALLED_TOOLS, 'INSTALLED_TOOLS must be set from E2E-01');

    const result = runInstalled(
      ['scaffold', 'context', '--phase', '1'],
      projectDir,
      INSTALLED_TOOLS
    );
    assert.ok(
      result.success,
      'scaffold context must exit 0\nstderr: ' + result.error
    );

    const phaseDir = path.join(projectDir, '.planning', 'phases', '01-test-phase');
    const contextFile = path.join(phaseDir, '01-CONTEXT.md');
    assert.ok(
      fs.existsSync(contextFile),
      'CONTEXT.md must be created at: ' + contextFile
    );
  });

  test('E2E-05: init plan-phase returns valid JSON', () => {
    assert.ok(INSTALLED_TOOLS, 'INSTALLED_TOOLS must be set from E2E-01');

    const result = runInstalled(
      ['init', 'plan-phase', '1'],
      projectDir,
      INSTALLED_TOOLS
    );
    assert.ok(
      result.success,
      'init plan-phase must exit 0\nstderr: ' + result.error + '\noutput: ' + result.output
    );

    let parsed;
    assert.doesNotThrow(
      () => { parsed = JSON.parse(result.output); },
      'init plan-phase output must be valid JSON\noutput: ' + result.output.slice(0, 500)
    );
    assert.ok(
      parsed !== null && typeof parsed === 'object',
      'init plan-phase JSON must be an object'
    );
    // Verify at least one expected key exists in the returned context
    const hasExpectedKey = 'phase_dir' in parsed || 'phase_number' in parsed || 'phase' in parsed || 'plans' in parsed;
    assert.ok(
      hasExpectedKey,
      'init plan-phase JSON must contain a recognized key (phase_dir, phase_number, phase, or plans)\nkeys: ' + Object.keys(parsed).join(', ')
    );
  });

  test('E2E-06: init execute-phase returns valid JSON when PLAN.md exists', () => {
    assert.ok(INSTALLED_TOOLS, 'INSTALLED_TOOLS must be set from E2E-01');

    // Write a minimal PLAN.md into the phase directory
    const planContent = [
      '---',
      'phase: 01-test-phase',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: []',
      'autonomous: true',
      'must_haves:',
      '  truths: ["test passes"]',
      '  artifacts: []',
      '  key_links: []',
      '---',
      '',
      '<objective>Test plan</objective>',
      '<tasks>',
      '<task type="auto">',
      '  <name>Task 1: Test</name>',
      '  <read_first>- test.txt</read_first>',
      '  <files>test.txt</files>',
      '  <action>Create test file</action>',
      '  <verify><automated>test -f test.txt</automated></verify>',
      '  <acceptance_criteria>- test.txt exists</acceptance_criteria>',
      '  <done>File exists</done>',
      '</task>',
      '</tasks>',
      '',
    ].join('\n');

    const phaseDir = path.join(projectDir, '.planning', 'phases', '01-test-phase');
    const planFile = path.join(phaseDir, '01-01-PLAN.md');
    fs.writeFileSync(planFile, planContent);

    const result = runInstalled(
      ['init', 'execute-phase', '1'],
      projectDir,
      INSTALLED_TOOLS
    );
    assert.ok(
      result.success,
      'init execute-phase must exit 0\nstderr: ' + result.error + '\noutput: ' + result.output
    );

    let parsed;
    assert.doesNotThrow(
      () => { parsed = JSON.parse(result.output); },
      'init execute-phase output must be valid JSON\noutput: ' + result.output.slice(0, 500)
    );
    assert.ok(
      parsed !== null && typeof parsed === 'object',
      'init execute-phase JSON must be an object'
    );
  });
});
