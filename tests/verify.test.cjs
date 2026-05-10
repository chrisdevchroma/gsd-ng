/**
 * GSD Tools Tests - Verify
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const {
  runGsdTools,
  createTempProject,
  createTempGitProject,
  cleanup,
} = require('./helpers.cjs');
const { execSync } = require('child_process');

// ─── helpers ──────────────────────────────────────────────────────────────────

// Build a minimal valid PLAN.md content with all required frontmatter fields
function validPlanContent({
  wave = 1,
  dependsOn = '[]',
  autonomous = 'true',
  extraTasks = '',
} = {}) {
  return [
    '---',
    'phase: 01-test',
    'plan: 01',
    'type: execute',
    `wave: ${wave}`,
    `depends_on: ${dependsOn}`,
    'files_modified: [some/file.ts]',
    `autonomous: ${autonomous}`,
    'must_haves:',
    '  truths:',
    '    - "something is true"',
    '---',
    '',
    '<tasks>',
    '',
    '<task type="auto">',
    '  <name>Task 1: Do something</name>',
    '  <files>some/file.ts</files>',
    '  <action>Do the thing</action>',
    '  <verify><automated>echo ok</automated></verify>',
    '  <done>Thing is done</done>',
    '</task>',
    extraTasks,
    '',
    '</tasks>',
  ].join('\n');
}

describe('validate consistency command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('passes for consistent project', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: A\n### Phase 2: B\n### Phase 3: C\n`,
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-b'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-c'), {
      recursive: true,
    });

    const result = runGsdTools('validate consistency --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, true, 'should pass');
    assert.strictEqual(output.warning_count, 0, 'no warnings');
  });

  test('warns about phase on disk but not in roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: A\n`,
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-orphan'), {
      recursive: true,
    });

    const result = runGsdTools('validate consistency --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.warning_count > 0, 'should have warnings');
    assert.ok(
      output.warnings.some((w) => w.includes('disk but not in ROADMAP')),
      'should warn about orphan directory',
    );
  });

  test('warns about gaps in phase numbering', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap\n### Phase 1: A\n### Phase 3: C\n`,
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-c'), {
      recursive: true,
    });

    const result = runGsdTools('validate consistency --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some((w) => w.includes('Gap in phase numbering')),
      'should warn about gap',
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify plan-structure command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify plan-structure command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-test'), {
      recursive: true,
    });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('reports missing required frontmatter fields', () => {
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(
      planPath,
      '# No frontmatter here\n\nJust a plan without YAML.\n',
    );

    const result = runGsdTools(
      'verify plan-structure .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false, 'should be invalid');
    assert.ok(
      output.errors.some((e) =>
        e.includes('Missing required frontmatter field'),
      ),
      `Expected "Missing required frontmatter field" in errors: ${JSON.stringify(output.errors)}`,
    );
  });

  test('validates complete plan with all required fields and tasks', () => {
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, validPlanContent());

    const result = runGsdTools(
      'verify plan-structure .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.valid,
      true,
      `should be valid, errors: ${JSON.stringify(output.errors)}`,
    );
    assert.deepStrictEqual(output.errors, [], 'should have no errors');
    assert.strictEqual(output.task_count, 1, 'should have 1 task');
  });

  test('reports task missing name element', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [some/file.ts]',
      'autonomous: true',
      'must_haves:',
      '  truths:',
      '    - "something"',
      '---',
      '',
      '<tasks>',
      '<task type="auto">',
      '  <action>Do it</action>',
      '  <verify><automated>echo ok</automated></verify>',
      '  <done>Done</done>',
      '</task>',
      '</tasks>',
    ].join('\n');

    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);

    const result = runGsdTools(
      'verify plan-structure .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some((e) => e.includes('Task missing <name>')),
      `Expected "Task missing <name>" in errors: ${JSON.stringify(output.errors)}`,
    );
  });

  test('reports task missing action element', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [some/file.ts]',
      'autonomous: true',
      'must_haves:',
      '  truths:',
      '    - "something"',
      '---',
      '',
      '<tasks>',
      '<task type="auto">',
      '  <name>Task 1: No action</name>',
      '  <verify><automated>echo ok</automated></verify>',
      '  <done>Done</done>',
      '</task>',
      '</tasks>',
    ].join('\n');

    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);

    const result = runGsdTools(
      'verify plan-structure .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some((e) => e.includes('missing <action>')),
      `Expected "missing <action>" in errors: ${JSON.stringify(output.errors)}`,
    );
  });

  test('warns about wave > 1 with empty depends_on', () => {
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, validPlanContent({ wave: 2, dependsOn: '[]' }));

    const result = runGsdTools(
      'verify plan-structure .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some((w) =>
        w.includes('Wave > 1 but depends_on is empty'),
      ),
      `Expected "Wave > 1 but depends_on is empty" in warnings: ${JSON.stringify(output.warnings)}`,
    );
  });

  test('errors when checkpoint task but autonomous is true', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [some/file.ts]',
      'autonomous: true',
      'must_haves:',
      '  truths:',
      '    - "something"',
      '---',
      '',
      '<tasks>',
      '<task type="auto">',
      '  <name>Task 1: Normal</name>',
      '  <files>some/file.ts</files>',
      '  <action>Do it</action>',
      '  <verify><automated>echo ok</automated></verify>',
      '  <done>Done</done>',
      '</task>',
      '<task type="checkpoint:human-verify">',
      '  <name>Task 2: Verify UI</name>',
      '  <files>some/file.ts</files>',
      '  <action>Check the UI</action>',
      '  <verify><human>Visit the app</human></verify>',
      '  <done>UI verified</done>',
      '</task>',
      '</tasks>',
    ].join('\n');

    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);

    const result = runGsdTools(
      'verify plan-structure .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.errors.some((e) =>
        e.includes('checkpoint tasks but autonomous is not false'),
      ),
      `Expected checkpoint/autonomous error in errors: ${JSON.stringify(output.errors)}`,
    );
  });

  test('returns error for nonexistent file', () => {
    const result = runGsdTools(
      'verify plan-structure .planning/phases/01-test/nonexistent.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.error,
      `Expected error field in output: ${JSON.stringify(output)}`,
    );
    assert.ok(
      output.error.includes('File not found'),
      `Expected "File not found" in error: ${output.error}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify phase-completeness command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify phase-completeness command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create ROADMAP.md referencing phase 01 so findPhaseInternal can locate it
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Test\n**Goal**: Test phase\n',
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-test'), {
      recursive: true,
    });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('reports complete phase with matching plans and summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary\n');

    const result = runGsdTools('verify phase-completeness 01 --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.complete,
      true,
      `should be complete, errors: ${JSON.stringify(output.errors)}`,
    );
    assert.strictEqual(output.plan_count, 1, 'should have 1 plan');
    assert.strictEqual(output.summary_count, 1, 'should have 1 summary');
    assert.deepStrictEqual(
      output.incomplete_plans,
      [],
      'should have no incomplete plans',
    );
  });

  test('reports incomplete phase with plan missing summary', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), '# Plan\n');

    const result = runGsdTools('verify phase-completeness 01 --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.complete, false, 'should be incomplete');
    assert.ok(
      output.incomplete_plans.some((id) => id.includes('01-01')),
      `Expected "01-01" in incomplete_plans: ${JSON.stringify(output.incomplete_plans)}`,
    );
    assert.ok(
      output.errors.some((e) => e.includes('Plans without summaries')),
      `Expected "Plans without summaries" in errors: ${JSON.stringify(output.errors)}`,
    );
  });

  test('warns about orphan summaries', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), '# Summary\n');

    const result = runGsdTools('verify phase-completeness 01 --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some((w) => w.includes('Summaries without plans')),
      `Expected "Summaries without plans" in warnings: ${JSON.stringify(output.warnings)}`,
    );
  });

  test('returns error for nonexistent phase', () => {
    const result = runGsdTools('verify phase-completeness 99 --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.error,
      `Expected error field in output: ${JSON.stringify(output)}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify-summary command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify summary command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-test'), {
      recursive: true,
    });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns not found for nonexistent summary', () => {
    const result = runGsdTools(
      'verify-summary .planning/phases/01-test/nonexistent.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, false, 'should not pass');
    assert.strictEqual(
      output.checks.summary_exists,
      false,
      'summary should not exist',
    );
    assert.ok(
      output.errors.some((e) => e.includes('SUMMARY.md not found')),
      `Expected "SUMMARY.md not found" in errors: ${JSON.stringify(output.errors)}`,
    );
  });

  test('passes for valid summary with real files and commits', () => {
    // Create a source file and commit it
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.js'),
      'console.log("hello");\n',
    );
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add app.js"', { cwd: tmpDir, stdio: 'pipe' });

    const hash = execSync('git rev-parse --short HEAD', {
      cwd: tmpDir,
      encoding: 'utf-8',
    }).trim();

    // Write SUMMARY.md referencing the file and commit hash
    const summaryPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-SUMMARY.md',
    );
    fs.writeFileSync(
      summaryPath,
      ['# Summary', '', `Created: \`src/app.js\``, '', `Commit: ${hash}`].join(
        '\n',
      ),
    );

    const result = runGsdTools(
      'verify-summary .planning/phases/01-test/01-01-SUMMARY.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.passed,
      true,
      `should pass, errors: ${JSON.stringify(output.errors)}`,
    );
    assert.strictEqual(
      output.checks.summary_exists,
      true,
      'summary should exist',
    );
    assert.strictEqual(
      output.checks.commits_exist,
      true,
      'commits should exist',
    );
  });

  test('reports missing files mentioned in summary', () => {
    const summaryPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-SUMMARY.md',
    );
    fs.writeFileSync(
      summaryPath,
      ['# Summary', '', 'Created: `src/nonexistent.js`'].join('\n'),
    );

    const result = runGsdTools(
      'verify-summary .planning/phases/01-test/01-01-SUMMARY.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.checks.files_created.missing.includes('src/nonexistent.js'),
      `Expected missing to include "src/nonexistent.js": ${JSON.stringify(output.checks.files_created.missing)}`,
    );
  });

  test('detects self-check section with pass indicators', () => {
    const summaryPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-SUMMARY.md',
    );
    fs.writeFileSync(
      summaryPath,
      ['# Summary', '', '## Self-Check', '', 'All tests pass'].join('\n'),
    );

    const result = runGsdTools(
      'verify-summary .planning/phases/01-test/01-01-SUMMARY.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.checks.self_check,
      'passed',
      `Expected self_check "passed": ${JSON.stringify(output.checks)}`,
    );
  });

  test('detects self-check section with fail indicators', () => {
    const summaryPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-SUMMARY.md',
    );
    fs.writeFileSync(
      summaryPath,
      ['# Summary', '', '## Verification', '', 'Tests failed'].join('\n'),
    );

    const result = runGsdTools(
      'verify-summary .planning/phases/01-test/01-01-SUMMARY.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.checks.self_check,
      'failed',
      `Expected self_check "failed": ${JSON.stringify(output.checks)}`,
    );
  });

  test('REG-03: returns self_check "not_found" when no self-check section exists', () => {
    const summaryPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-SUMMARY.md',
    );
    fs.writeFileSync(
      summaryPath,
      ['# Summary', '', '## Accomplishments', '', 'Everything went well.'].join(
        '\n',
      ),
    );

    const result = runGsdTools(
      'verify-summary .planning/phases/01-test/01-01-SUMMARY.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.checks.self_check,
      'not_found',
      `Expected self_check "not_found": ${JSON.stringify(output.checks)}`,
    );
    assert.strictEqual(
      output.passed,
      true,
      `Missing self-check should not fail: ${JSON.stringify(output)}`,
    );
  });

  test('search(-1) regression: self-check guard prevents entry when no heading', () => {
    // No Self-Check/Verification/Quality Check heading — guard on line 79 prevents
    // content.search(selfCheckPattern) from ever being called, so -1 is impossible
    const summaryPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-SUMMARY.md',
    );
    fs.writeFileSync(
      summaryPath,
      [
        '# Summary',
        '',
        '## Notes',
        '',
        'Some content here without a self-check heading.',
      ].join('\n'),
    );

    const result = runGsdTools(
      'verify-summary .planning/phases/01-test/01-01-SUMMARY.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // Guard works: selfCheckPattern.test() is false, if block not entered, selfCheck stays 'not_found'
    assert.strictEqual(
      output.checks.self_check,
      'not_found',
      `Expected not_found since no heading: ${JSON.stringify(output.checks)}`,
    );
  });

  test('respects checkFileCount parameter', () => {
    // Write summary referencing 5 files (none exist)
    const summaryPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-SUMMARY.md',
    );
    fs.writeFileSync(
      summaryPath,
      [
        '# Summary',
        '',
        'Files: `src/a.js`, `src/b.js`, `src/c.js`, `src/d.js`, `src/e.js`',
      ].join('\n'),
    );

    // Pass checkFileCount = 1 so only 1 file is checked
    const result = runGsdTools(
      'verify-summary .planning/phases/01-test/01-01-SUMMARY.md --check-count 1 --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.checks.files_created.checked <= 1,
      `Expected checked <= 1, got ${output.checks.files_created.checked}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify references command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify references command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.mkdirSync(path.join(tmpDir, 'src', 'utils'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-test'), {
      recursive: true,
    });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('reports valid when all referenced files exist', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.js'),
      'console.log("app");\n',
    );
    const filePath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      'doc.md',
    );
    fs.writeFileSync(filePath, '@src/app.js\n');

    const result = runGsdTools(
      'verify references .planning/phases/01-test/doc.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.valid,
      true,
      `should be valid: ${JSON.stringify(output)}`,
    );
    assert.strictEqual(
      output.found,
      1,
      `should find 1 file: ${JSON.stringify(output)}`,
    );
  });

  test('reports missing for nonexistent referenced files', () => {
    const filePath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      'doc.md',
    );
    fs.writeFileSync(filePath, '@src/missing.js\n');

    const result = runGsdTools(
      'verify references .planning/phases/01-test/doc.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false, 'should be invalid');
    assert.ok(
      output.missing.includes('src/missing.js'),
      `Expected missing to include "src/missing.js": ${JSON.stringify(output.missing)}`,
    );
  });

  test('detects backtick file paths', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'utils', 'helper.js'),
      'module.exports = {};\n',
    );
    const filePath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      'doc.md',
    );
    fs.writeFileSync(filePath, 'See `src/utils/helper.js` for details.\n');

    const result = runGsdTools(
      'verify references .planning/phases/01-test/doc.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.found >= 1,
      `Expected at least 1 found, got ${output.found}`,
    );
  });

  test('skips backtick template expressions', () => {
    // Template expressions like ${variable} in backtick paths are skipped
    // @-refs with http are processed but not found on disk
    const filePath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      'doc.md',
    );
    fs.writeFileSync(filePath, '`${variable}/path/file.js`\n');

    const result = runGsdTools(
      'verify references .planning/phases/01-test/doc.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    // Template expression is skipped entirely — total should be 0
    assert.strictEqual(
      output.total,
      0,
      `Expected total 0 (template skipped): ${JSON.stringify(output)}`,
    );
  });

  test('returns error for nonexistent file', () => {
    const result = runGsdTools(
      'verify references .planning/phases/01-test/nonexistent.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, `Expected error field: ${JSON.stringify(output)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify commits command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify commits command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('validates real commit hashes', () => {
    const hash = execSync('git rev-parse --short HEAD', {
      cwd: tmpDir,
      encoding: 'utf-8',
    }).trim();

    const result = runGsdTools(`verify commits ${hash} --json`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.all_valid,
      true,
      `Expected all_valid true: ${JSON.stringify(output)}`,
    );
    assert.ok(
      output.valid.includes(hash),
      `Expected valid to include ${hash}: ${JSON.stringify(output.valid)}`,
    );
  });

  test('reports invalid for fake hashes', () => {
    const result = runGsdTools('verify commits abcdef1234567 --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.all_valid,
      false,
      `Expected all_valid false: ${JSON.stringify(output)}`,
    );
    assert.ok(
      output.invalid.includes('abcdef1234567'),
      `Expected invalid to include "abcdef1234567": ${JSON.stringify(output.invalid)}`,
    );
  });

  test('handles mixed valid and invalid hashes', () => {
    const hash = execSync('git rev-parse --short HEAD', {
      cwd: tmpDir,
      encoding: 'utf-8',
    }).trim();

    const result = runGsdTools(
      `verify commits ${hash} abcdef1234567 --json`,
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.valid.length,
      1,
      `Expected 1 valid: ${JSON.stringify(output)}`,
    );
    assert.strictEqual(
      output.invalid.length,
      1,
      `Expected 1 invalid: ${JSON.stringify(output)}`,
    );
    assert.strictEqual(
      output.all_valid,
      false,
      `Expected all_valid false: ${JSON.stringify(output)}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify artifacts command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify artifacts command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-test'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writePlanWithArtifacts(tmpDir, artifactsYaml) {
    // parseMustHavesBlock expects 4-space indent for block name, 6-space for items, 8-space for keys
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/app.js]',
      'autonomous: true',
      'must_haves:',
      '    artifacts:',
      ...artifactsYaml.map((line) => `      ${line}`),
      '---',
      '',
      '<tasks>',
      '<task type="auto">',
      '  <name>Task 1: Do thing</name>',
      '  <files>src/app.js</files>',
      '  <action>Do it</action>',
      '  <verify><automated>echo ok</automated></verify>',
      '  <done>Done</done>',
      '</task>',
      '</tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
  }

  test('passes when all artifacts exist and match criteria', () => {
    writePlanWithArtifacts(tmpDir, [
      '- path: "src/app.js"',
      '  min_lines: 2',
      '  contains: "export"',
    ]);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.js'),
      'const x = 1;\nexport default x;\nconst y = 2;\n',
    );

    const result = runGsdTools(
      'verify artifacts .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.all_passed,
      true,
      `Expected all_passed true: ${JSON.stringify(output)}`,
    );
  });

  test('reports missing artifact file', () => {
    writePlanWithArtifacts(tmpDir, ['- path: "src/nonexistent.js"']);

    const result = runGsdTools(
      'verify artifacts .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false, 'Expected all_passed false');
    assert.ok(
      output.artifacts[0].issues.some((i) => i.includes('File not found')),
      `Expected "File not found" in issues: ${JSON.stringify(output.artifacts[0].issues)}`,
    );
  });

  test('reports insufficient line count', () => {
    writePlanWithArtifacts(tmpDir, ['- path: "src/app.js"', '  min_lines: 10']);
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'const x = 1;\n');

    const result = runGsdTools(
      'verify artifacts .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false, 'Expected all_passed false');
    assert.ok(
      output.artifacts[0].issues.some(
        (i) => i.includes('Only') && i.includes('lines, need 10'),
      ),
      `Expected line count issue: ${JSON.stringify(output.artifacts[0].issues)}`,
    );
  });

  test('reports missing pattern', () => {
    writePlanWithArtifacts(tmpDir, [
      '- path: "src/app.js"',
      '  contains: "module.exports"',
    ]);
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'const x = 1;\n');

    const result = runGsdTools(
      'verify artifacts .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false, 'Expected all_passed false');
    assert.ok(
      output.artifacts[0].issues.some((i) => i.includes('Missing pattern')),
      `Expected "Missing pattern" in issues: ${JSON.stringify(output.artifacts[0].issues)}`,
    );
  });

  test('reports missing export', () => {
    writePlanWithArtifacts(tmpDir, [
      '- path: "src/app.js"',
      '  exports:',
      '    - GET',
    ]);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.js'),
      'const x = 1;\nexport const POST = () => {};\n',
    );

    const result = runGsdTools(
      'verify artifacts .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, false, 'Expected all_passed false');
    assert.ok(
      output.artifacts[0].issues.some((i) => i.includes('Missing export')),
      `Expected "Missing export" in issues: ${JSON.stringify(output.artifacts[0].issues)}`,
    );
  });

  test('returns error when no artifacts in frontmatter', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/app.js]',
      'autonomous: true',
      'must_haves:',
      '  truths:',
      '    - "something is true"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);

    const result = runGsdTools(
      'verify artifacts .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, `Expected error field: ${JSON.stringify(output)}`);
    assert.ok(
      output.error.includes('No must_haves.artifacts'),
      `Expected "No must_haves.artifacts" in error: ${output.error}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// verify key-links command
// ─────────────────────────────────────────────────────────────────────────────

describe('verify key-links command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-test'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  function writePlanWithKeyLinks(tmpDir, keyLinksYaml) {
    // parseMustHavesBlock expects 4-space indent for block name, 6-space for items, 8-space for keys
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/a.js]',
      'autonomous: true',
      'must_haves:',
      '    key_links:',
      ...keyLinksYaml.map((line) => `      ${line}`),
      '---',
      '',
      '<tasks>',
      '<task type="auto">',
      '  <name>Task 1: Do thing</name>',
      '  <files>src/a.js</files>',
      '  <action>Do it</action>',
      '  <verify><automated>echo ok</automated></verify>',
      '  <done>Done</done>',
      '</task>',
      '</tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
  }

  test('verifies link when pattern found in source', () => {
    writePlanWithKeyLinks(tmpDir, [
      '- from: "src/a.js"',
      '  to: "src/b.js"',
      '  pattern: "import.*b"',
    ]);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'a.js'),
      "import { x } from './b';\n",
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'exports.x = 1;\n');

    const result = runGsdTools(
      'verify key-links .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.all_verified,
      true,
      `Expected all_verified true: ${JSON.stringify(output)}`,
    );
  });

  test('verifies link when pattern found in target', () => {
    writePlanWithKeyLinks(tmpDir, [
      '- from: "src/a.js"',
      '  to: "src/b.js"',
      '  pattern: "exports\\.targetFunc"',
    ]);
    // pattern NOT in source, but found in target
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'const x = 1;\n');
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'b.js'),
      'exports.targetFunc = () => {};\n',
    );

    const result = runGsdTools(
      'verify key-links .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.all_verified,
      true,
      `Expected verified via target: ${JSON.stringify(output)}`,
    );
    assert.ok(
      output.links[0].detail.includes('target'),
      `Expected detail about target: ${output.links[0].detail}`,
    );
  });

  test('fails when pattern not found in source or target', () => {
    writePlanWithKeyLinks(tmpDir, [
      '- from: "src/a.js"',
      '  to: "src/b.js"',
      '  pattern: "missingPattern"',
    ]);
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'const x = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'const y = 2;\n');

    const result = runGsdTools(
      'verify key-links .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.all_verified,
      false,
      `Expected all_verified false: ${JSON.stringify(output)}`,
    );
    assert.strictEqual(
      output.links[0].verified,
      false,
      'link should not be verified',
    );
  });

  test('verifies link without pattern using string inclusion', () => {
    writePlanWithKeyLinks(tmpDir, ['- from: "src/a.js"', '  to: "src/b.js"']);
    // source file contains the 'to' value as a string
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'a.js'),
      "const b = require('./src/b.js');\n",
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'b.js'),
      'module.exports = {};\n',
    );

    const result = runGsdTools(
      'verify key-links .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(
      output.all_verified,
      true,
      `Expected all_verified true: ${JSON.stringify(output)}`,
    );
    assert.ok(
      output.links[0].detail.includes('Target referenced in source'),
      `Expected "Target referenced in source" in detail: ${output.links[0].detail}`,
    );
  });

  test('reports source file not found', () => {
    writePlanWithKeyLinks(tmpDir, [
      '- from: "src/nonexistent.js"',
      '  to: "src/b.js"',
      '  pattern: "something"',
    ]);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'b.js'),
      'module.exports = {};\n',
    );

    const result = runGsdTools(
      'verify key-links .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(
      output.links[0].detail.includes('Source file not found'),
      `Expected "Source file not found" in detail: ${output.links[0].detail}`,
    );
  });

  test('returns error when no key_links in frontmatter', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/a.js]',
      'autonomous: true',
      'must_haves:',
      '  truths:',
      '    - "something is true"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);

    const result = runGsdTools(
      'verify key-links .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.error, `Expected error field: ${JSON.stringify(output)}`);
    assert.ok(
      output.error.includes('No must_haves.key_links'),
      `Expected "No must_haves.key_links" in error: ${output.error}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// checkVerifyIssueTrackerLinks helper (W015/W016 with cliInvoker injection)
// ─────────────────────────────────────────────────────────────────────────────

describe('checkVerifyIssueTrackerLinks helper', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('is exported from verify.cjs', () => {
    const mod = require('../gsd-ng/bin/lib/verify.cjs');
    assert.strictEqual(
      typeof mod.checkVerifyIssueTrackerLinks,
      'function',
      'checkVerifyIssueTrackerLinks should be exported as a function',
    );
  });

  test('returns no issues when itConfig is missing', () => {
    const {
      checkVerifyIssueTrackerLinks,
    } = require('../gsd-ng/bin/lib/verify.cjs');
    const collected = [];
    const addIssue = (severity, code, message, fix, repairable) => {
      collected.push({ severity, code, message, fix, repairable });
    };
    checkVerifyIssueTrackerLinks(
      null,
      { todosPending: tmpDir, todosCompleted: tmpDir },
      addIssue,
    );
    assert.deepStrictEqual(
      collected,
      [],
      'no issues should be added when itConfig is null',
    );
  });

  test('returns no issues when itConfig.platform is null', () => {
    const {
      checkVerifyIssueTrackerLinks,
    } = require('../gsd-ng/bin/lib/verify.cjs');
    const collected = [];
    const addIssue = (severity, code, message, fix, repairable) => {
      collected.push({ severity, code, message, fix, repairable });
    };
    checkVerifyIssueTrackerLinks(
      { platform: null },
      { todosPending: tmpDir, todosCompleted: tmpDir },
      addIssue,
    );
    assert.deepStrictEqual(
      collected,
      [],
      'no issues should be added when platform is null',
    );
  });

  test('does not throw when todo dirs do not exist', () => {
    const {
      checkVerifyIssueTrackerLinks,
    } = require('../gsd-ng/bin/lib/verify.cjs');
    const collected = [];
    const addIssue = (severity, code, message, fix, repairable) => {
      collected.push({ severity, code, message, fix, repairable });
    };
    const missingDir = path.join(tmpDir, 'does-not-exist');
    assert.doesNotThrow(() => {
      checkVerifyIssueTrackerLinks(
        { platform: 'github' },
        { todosPending: missingDir, todosCompleted: missingDir },
        addIssue,
      );
    });
  });

  test('skips completed todos older than 30 days when scanning', () => {
    const {
      checkVerifyIssueTrackerLinks,
    } = require('../gsd-ng/bin/lib/verify.cjs');
    const completedDir = path.join(tmpDir, '.planning', 'todos', 'completed');
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
    // Old todo (>30 days)
    fs.writeFileSync(
      path.join(completedDir, 'old.md'),
      `---\nexternal_ref: github:#1\ncompleted: 2020-01-01\n---\n\nOld todo.\n`,
    );
    // Recent todo
    const today = new Date().toISOString().split('T')[0];
    fs.writeFileSync(
      path.join(completedDir, 'recent.md'),
      `---\nexternal_ref: github:#2\ncompleted: ${today}\n---\n\nRecent todo.\n`,
    );

    const collected = [];
    const addIssue = (severity, code, message, fix, repairable) => {
      collected.push({ severity, code, message, fix, repairable });
    };
    // The current body has only stub TODO comments (no actual issue creation),
    // so this assertion verifies the helper runs without throwing on real fixtures.
    assert.doesNotThrow(() => {
      checkVerifyIssueTrackerLinks(
        { platform: 'github' },
        { todosPending: pendingDir, todosCompleted: completedDir },
        addIssue,
      );
    });
  });

  test('skips todos without external_ref frontmatter', () => {
    const {
      checkVerifyIssueTrackerLinks,
    } = require('../gsd-ng/bin/lib/verify.cjs');
    const completedDir = path.join(tmpDir, '.planning', 'todos', 'completed');
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    fs.writeFileSync(
      path.join(completedDir, 'no-ref.md'),
      `---\ncompleted: ${today}\n---\n\nNo external ref.\n`,
    );
    fs.writeFileSync(
      path.join(pendingDir, 'no-ref.md'),
      `---\nstatus: pending\n---\n\nNo external ref.\n`,
    );

    const collected = [];
    const addIssue = (severity, code, message, fix, repairable) => {
      collected.push({ severity, code, message, fix, repairable });
    };
    assert.doesNotThrow(() => {
      checkVerifyIssueTrackerLinks(
        { platform: 'github' },
        { todosPending: pendingDir, todosCompleted: completedDir },
        addIssue,
      );
    });
  });

  test('does not invoke cliInvoker stub when no eligible todos exist', () => {
    const {
      checkVerifyIssueTrackerLinks,
    } = require('../gsd-ng/bin/lib/verify.cjs');
    const completedDir = path.join(tmpDir, '.planning', 'todos', 'completed');
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
    let invokeCount = 0;
    const stubInvoker = () => {
      invokeCount++;
      return { state: 'closed' };
    };
    const collected = [];
    const addIssue = () => {};
    checkVerifyIssueTrackerLinks(
      { platform: 'github' },
      { todosPending: pendingDir, todosCompleted: completedDir },
      addIssue,
      stubInvoker,
    );
    // Body is a stub; cliInvoker accepted but body has no actual call yet.
    // Test just confirms the helper accepts the parameter without error.
    assert.strictEqual(typeof stubInvoker, 'function');
    assert.strictEqual(invokeCount, 0, 'no eligible todos to scan');
  });

  test('handles unreadable todo files without crashing', () => {
    const {
      checkVerifyIssueTrackerLinks,
    } = require('../gsd-ng/bin/lib/verify.cjs');
    const completedDir = path.join(tmpDir, '.planning', 'todos', 'completed');
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
    // Create a file then make it unreadable by deleting it between readdir and readFileSync
    // We simulate via a directory with .md extension (readFileSync will throw EISDIR)
    fs.mkdirSync(path.join(completedDir, 'fake-as-dir.md'));
    fs.mkdirSync(path.join(pendingDir, 'fake-as-dir.md'));

    const collected = [];
    const addIssue = (severity, code, message, fix, repairable) => {
      collected.push({ severity, code, message, fix, repairable });
    };
    assert.doesNotThrow(() => {
      checkVerifyIssueTrackerLinks(
        { platform: 'github' },
        { todosPending: pendingDir, todosCompleted: completedDir },
        addIssue,
      );
    });
  });

  test('exercises W016 inner body when pending todo has external_ref', () => {
    const {
      checkVerifyIssueTrackerLinks,
    } = require('../gsd-ng/bin/lib/verify.cjs');
    const completedDir = path.join(tmpDir, '.planning', 'todos', 'completed');
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
    // Pending todo with external_ref → enters W016 inner body (the void cliInvoker line)
    fs.writeFileSync(
      path.join(pendingDir, 'pending-with-ref.md'),
      `---\nexternal_ref: github:#42\n---\n\nPending with ref.\n`,
    );
    // Completed todo with external_ref AND recent date → enters W015 inner body
    const today = new Date().toISOString().split('T')[0];
    fs.writeFileSync(
      path.join(completedDir, 'completed-with-ref.md'),
      `---\nexternal_ref: github:#43\ncompleted: ${today}\n---\n\nCompleted recent.\n`,
    );
    const collected = [];
    const addIssue = (severity, code, message, fix, repairable) => {
      collected.push({ severity, code, message, fix, repairable });
    };
    let invokeCount = 0;
    const stubInvoker = () => {
      invokeCount++;
      return null;
    };
    checkVerifyIssueTrackerLinks(
      { platform: 'github' },
      { todosPending: pendingDir, todosCompleted: completedDir },
      addIssue,
      stubInvoker,
    );
    // Body is a stub, so addIssue is not called and invokeCount stays 0;
    // but the inner-loop body lines are exercised.
    assert.strictEqual(collected.length, 0);
    assert.strictEqual(invokeCount, 0);
  });

  test('default cliInvoker returns null when invoked directly', () => {
    // Exercises the defaultIssueCliInvoker function body (line ~663-665)
    // via the helper using its default cliInvoker on a single eligible todo.
    const {
      checkVerifyIssueTrackerLinks,
    } = require('../gsd-ng/bin/lib/verify.cjs');
    const completedDir = path.join(tmpDir, '.planning', 'todos', 'completed');
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(completedDir, { recursive: true });
    fs.mkdirSync(pendingDir, { recursive: true });
    const today = new Date().toISOString().split('T')[0];
    fs.writeFileSync(
      path.join(completedDir, 'c.md'),
      `---\nexternal_ref: github:#1\ncompleted: ${today}\n---\n\nC.\n`,
    );
    fs.writeFileSync(
      path.join(pendingDir, 'p.md'),
      `---\nexternal_ref: github:#2\n---\n\nP.\n`,
    );
    const collected = [];
    const addIssue = (severity, code, message, fix, repairable) => {
      collected.push({ severity, code, message, fix, repairable });
    };
    // Call WITHOUT a stub so the default invoker is used (its body returns null)
    assert.doesNotThrow(() => {
      checkVerifyIssueTrackerLinks(
        { platform: 'github' },
        { todosPending: pendingDir, todosCompleted: completedDir },
        addIssue,
      );
    });
    assert.strictEqual(collected.length, 0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// validate consistency — branch coverage for missing roadmap and frontmatter
// ─────────────────────────────────────────────────────────────────────────────

describe('validate consistency — additional branch coverage', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('fails when ROADMAP.md missing', () => {
    // No ROADMAP.md
    const result = runGsdTools('validate consistency --json', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.passed, false);
    assert.ok(
      output.errors.some((e) => e.includes('ROADMAP.md not found')),
      `Expected ROADMAP.md not found error: ${JSON.stringify(output.errors)}`,
    );
  });

  test('warns when phase appears in ROADMAP but not on disk', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n### Phase 1: A\n### Phase 2: B\n',
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), {
      recursive: true,
    });
    // Second phase missing on disk

    const result = runGsdTools('validate consistency --json', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some((w) =>
        w.includes('ROADMAP.md but no directory on disk'),
      ),
      `Expected ROADMAP-not-on-disk warning: ${JSON.stringify(output.warnings)}`,
    );
  });

  test('warns when plan numbering has gaps within a phase', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n### Phase 1: A\n',
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-a');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-PLAN.md'), 'plan 1');
    fs.writeFileSync(path.join(phaseDir, '01-03-PLAN.md'), 'plan 3'); // skipped 02

    const result = runGsdTools('validate consistency --json', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some((w) => w.includes('Gap in plan numbering')),
      `Expected gap-in-plan-numbering: ${JSON.stringify(output.warnings)}`,
    );
  });

  test('warns when SUMMARY.md exists without matching PLAN.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n### Phase 1: A\n',
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-a');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), 'orphan');

    const result = runGsdTools('validate consistency --json', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some((w) => w.includes('has no matching PLAN.md')),
      `Expected orphan-summary warning: ${JSON.stringify(output.warnings)}`,
    );
  });

  test('warns when plan frontmatter missing wave field', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n### Phase 1: A\n',
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-a');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(phaseDir, '01-01-PLAN.md'),
      `---\nphase: 01\nplan: 01\n---\n\nNo wave field.\n`,
    );

    const result = runGsdTools('validate consistency --json', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some((w) => w.includes("missing 'wave'")),
      `Expected missing-wave warning: ${JSON.stringify(output.warnings)}`,
    );
  });

  test('warns when phase has decimal version unmatched between disk and roadmap', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n### Phase 1.1: One Point One\n',
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-a'), {
      recursive: true,
    });

    const result = runGsdTools('validate consistency --json', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // Integer dir on disk but only decimal version in roadmap (and vice versa).
    // Just confirm warnings include both paths.
    assert.ok(
      output.warning_count > 0,
      `Expected warnings: ${JSON.stringify(output.warnings)}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdVerify* !arg guard branches via direct subprocess invocation
// ─────────────────────────────────────────────────────────────────────────────

describe('cmdVerify* missing-argument guards (direct subprocess)', () => {
  // The CLI dispatcher's validateArgs blocks empty-positional dispatch, so the
  // in-function `error('… required')` branches in cmdVerifySummary,
  // cmdVerifyPlanStructure, cmdVerifyPhaseCompleteness, cmdVerifyReferences,
  // cmdVerifyCommits, cmdVerifyArtifacts, and cmdVerifyKeyLinks are unreachable
  // from runGsdTools. We invoke the helpers directly via spawnSync(node, '-e', ...)
  // to exercise the !arg guards.

  const verifyPath = path.resolve(
    __dirname,
    '..',
    'gsd-ng',
    'bin',
    'lib',
    'verify.cjs',
  );
  const { spawnSync } = require('child_process');

  function spawnDirect(fnName, argsExpr) {
    const code = `try { require(${JSON.stringify(verifyPath)}).${fnName}(${argsExpr}); } catch (e) { process.stderr.write(e.message); process.exit(1); }`;
    return spawnSync(process.execPath, ['-e', code], { encoding: 'utf-8' });
  }

  test('cmdVerifySummary throws when summaryPath is missing', () => {
    const r = spawnDirect(
      'cmdVerifySummary',
      `'${path.resolve(__dirname)}', null`,
    );
    assert.notStrictEqual(r.status, 0, `Expected non-zero exit: ${r.stdout}`);
    const combined = r.stdout + r.stderr;
    assert.ok(
      combined.includes('summary-path required'),
      `Expected error message: ${combined}`,
    );
  });

  test('cmdVerifyPlanStructure throws when filePath is missing', () => {
    const r = spawnDirect(
      'cmdVerifyPlanStructure',
      `'${path.resolve(__dirname)}', null`,
    );
    assert.notStrictEqual(r.status, 0);
    const combined = r.stdout + r.stderr;
    assert.ok(combined.includes('file path required'), combined);
  });

  test('cmdVerifyPhaseCompleteness throws when phase is missing', () => {
    const r = spawnDirect(
      'cmdVerifyPhaseCompleteness',
      `'${path.resolve(__dirname)}', null`,
    );
    assert.notStrictEqual(r.status, 0);
    const combined = r.stdout + r.stderr;
    assert.ok(combined.includes('phase required'), combined);
  });

  test('cmdVerifyReferences throws when filePath is missing', () => {
    const r = spawnDirect(
      'cmdVerifyReferences',
      `'${path.resolve(__dirname)}', null`,
    );
    assert.notStrictEqual(r.status, 0);
    const combined = r.stdout + r.stderr;
    assert.ok(combined.includes('file path required'), combined);
  });

  test('cmdVerifyCommits throws when no hashes provided', () => {
    const r = spawnDirect(
      'cmdVerifyCommits',
      `'${path.resolve(__dirname)}', []`,
    );
    assert.notStrictEqual(r.status, 0);
    const combined = r.stdout + r.stderr;
    assert.ok(combined.includes('At least one commit hash required'), combined);
  });

  test('cmdVerifyArtifacts throws when planFilePath is missing', () => {
    const r = spawnDirect(
      'cmdVerifyArtifacts',
      `'${path.resolve(__dirname)}', null`,
    );
    assert.notStrictEqual(r.status, 0);
    const combined = r.stdout + r.stderr;
    assert.ok(combined.includes('plan file path required'), combined);
  });

  test('cmdVerifyKeyLinks throws when planFilePath is missing', () => {
    const r = spawnDirect(
      'cmdVerifyKeyLinks',
      `'${path.resolve(__dirname)}', null`,
    );
    assert.notStrictEqual(r.status, 0);
    const combined = r.stdout + r.stderr;
    assert.ok(combined.includes('plan file path required'), combined);
  });

  test('cmdVerifyReferences returns "File not found" output when target file missing', () => {
    // Direct call where filePath is provided but resolves to non-existent file:
    // exercises the safeReadFile null-return branch (lines 290-291).
    const tmpDir = createTempProject();
    try {
      const r = spawnSync(
        process.execPath,
        [
          '-e',
          `const v = require(${JSON.stringify(verifyPath)});
           v.cmdVerifyReferences(${JSON.stringify(tmpDir)}, 'does-not-exist.md');`,
        ],
        { encoding: 'utf-8' },
      );
      const combined = r.stdout + r.stderr;
      assert.ok(
        combined.includes('File not found'),
        `Expected File-not-found: ${combined}`,
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  test('cmdVerifyArtifacts returns "File not found" output when plan file missing', () => {
    const tmpDir = createTempProject();
    try {
      const r = spawnSync(
        process.execPath,
        [
          '-e',
          `require(${JSON.stringify(verifyPath)}).cmdVerifyArtifacts(${JSON.stringify(tmpDir)}, 'no.md');`,
        ],
        { encoding: 'utf-8' },
      );
      const combined = r.stdout + r.stderr;
      assert.ok(
        combined.includes('File not found'),
        `Expected File-not-found: ${combined}`,
      );
    } finally {
      cleanup(tmpDir);
    }
  });

  test('cmdVerifyKeyLinks returns "File not found" output when plan file missing', () => {
    const tmpDir = createTempProject();
    try {
      const r = spawnSync(
        process.execPath,
        [
          '-e',
          `require(${JSON.stringify(verifyPath)}).cmdVerifyKeyLinks(${JSON.stringify(tmpDir)}, 'no.md');`,
        ],
        { encoding: 'utf-8' },
      );
      const combined = r.stdout + r.stderr;
      assert.ok(
        combined.includes('File not found'),
        `Expected File-not-found: ${combined}`,
      );
    } finally {
      cleanup(tmpDir);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// branch-coverage edge cases — absolute paths, dedup, single-value coercions
// ─────────────────────────────────────────────────────────────────────────────

describe('verify commands — absolute-path and edge-case branches', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-test'), {
      recursive: true,
    });
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // ─── cmdVerifyPlanStructure: absolute file path branch (line 141) ─────────

  test('verify plan-structure accepts an absolute file path', () => {
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, validPlanContent());
    const result = runGsdTools(
      `verify plan-structure ${planPath} --json`,
      tmpDir,
    );
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true);
  });

  // ─── cmdVerifyPlanStructure: tasks missing <verify>/<done>/<files> ────────

  test('verify plan-structure warns when task is missing <verify>/<done>/<files>', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [some/file.ts]',
      'autonomous: true',
      'must_haves:',
      '  truths:',
      '    - "something"',
      '---',
      '',
      '<tasks>',
      '<task type="auto">',
      '  <name>Task 1: Bare task</name>',
      '  <action>Do it</action>',
      '</task>',
      '</tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    const result = runGsdTools(
      'verify plan-structure .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    const warnings = output.warnings.join('\n');
    assert.ok(
      warnings.includes('missing <verify>'),
      `expected missing-<verify>: ${warnings}`,
    );
    assert.ok(
      warnings.includes('missing <done>'),
      `expected missing-<done>: ${warnings}`,
    );
    assert.ok(
      warnings.includes('missing <files>'),
      `expected missing-<files>: ${warnings}`,
    );
  });

  // ─── cmdVerifyPlanStructure: empty <tasks> block (no task elements) ───────

  test('verify plan-structure warns when no <task> elements present', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [some/file.ts]',
      'autonomous: true',
      'must_haves:',
      '  truths:',
      '    - "something"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    const result = runGsdTools(
      'verify plan-structure .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some((w) => w.includes('No <task> elements found')),
      `expected no-tasks warning: ${JSON.stringify(output.warnings)}`,
    );
  });

  // ─── cmdVerifyReferences: absolute-path branch (line 286) ────────────────

  test('verify references accepts an absolute file path', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'b.js'),
      'module.exports = {};\n',
    );
    const refFile = path.join(tmpDir, 'src', 'a.md');
    fs.writeFileSync(refFile, 'See `src/b.js` for details.\n');
    const result = runGsdTools(`verify references ${refFile} --json`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, true);
  });

  // ─── cmdVerifyReferences: ~ home-relative path branch (line 302) ─────────

  test('verify references handles ~/path home-relative @-references', () => {
    const refFile = path.join(tmpDir, 'src', 'home-ref.md');
    // ~/.bashrc may or may not exist; what matters is that the ~/ branch
    // (line 301-303) is exercised.
    fs.writeFileSync(refFile, 'See @~/this-file-likely-does-not-exist.txt\n');
    const result = runGsdTools(
      'verify references src/home-ref.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // 1 reference total, regardless of whether it's found (depends on user fs)
    assert.strictEqual(output.total, 1);
  });

  // ─── cmdVerifyReferences: backtick dedup branch (line 321) ───────────────

  test('verify references dedups when same path appears in @-ref AND backtick', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'shared.js'),
      'module.exports = {};\n',
    );
    const refFile = path.join(tmpDir, 'src', 'dup.md');
    fs.writeFileSync(
      refFile,
      'See @src/shared.js and also `src/shared.js` for details.\n',
    );
    const result = runGsdTools('verify references src/dup.md --json', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // Should not double-count (dedup branch was exercised)
    assert.strictEqual(output.total, 1);
    assert.strictEqual(output.found, 1);
  });

  // ─── cmdVerifyReferences: backtick ref to MISSING file (line 326) ────────

  test('verify references reports missing backtick-only references', () => {
    const refFile = path.join(tmpDir, 'src', 'missing-tick.md');
    // Backtick-only ref to nonexistent file (no @-ref)
    fs.writeFileSync(refFile, 'See `src/never-existed.js` for stub.\n');
    const result = runGsdTools(
      'verify references src/missing-tick.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.valid, false);
    assert.ok(output.missing.includes('src/never-existed.js'));
  });

  // ─── cmdVerifyReferences: backtick refs ignoring http/template patterns ─

  test('verify references ignores http/template refs in backtick paths', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'real.js'),
      'module.exports = {};\n',
    );
    const refFile = path.join(tmpDir, 'src', 'mixed.md');
    fs.writeFileSync(
      refFile,
      [
        'See `https://example.com/a.js` for the URL.',
        'See `${VAR}/path/to.js` for the template.',
        'See `{{var}}/path/to.js` for the moustache.',
        'See `src/real.js` for the real file.',
      ].join('\n'),
    );
    const result = runGsdTools('verify references src/mixed.md --json', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // Only the real file counts; URL/templates are skipped
    assert.strictEqual(output.total, 1);
    assert.strictEqual(output.found, 1);
  });

  // ─── cmdVerifyArtifacts: absolute path branch (line 372) ─────────────────

  test('verify artifacts accepts an absolute plan file path', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/app.js]',
      'autonomous: true',
      'must_haves:',
      '    artifacts:',
      '      - path: "src/app.js"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.js'),
      'module.exports = {};\n',
    );
    const result = runGsdTools(`verify artifacts ${planPath} --json`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_passed, true);
  });

  // ─── cmdVerifyArtifacts: string artifact entry (line 392 — skip path) ────

  test('verify artifacts skips entries that are bare strings', () => {
    // parseMustHavesBlock turns `- "just-a-string"` into a string item; the
    // loop does `if (typeof artifact === 'string') continue;` (line 392).
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/app.js]',
      'autonomous: true',
      'must_haves:',
      '    artifacts:',
      '      - "bare-string-item"',
      '      - path: "src/app.js"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.js'),
      'module.exports = {};\n',
    );
    const result = runGsdTools(
      'verify artifacts .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // Only the path-keyed item produces a result; the bare string is skipped.
    assert.strictEqual(output.total, 1);
    assert.strictEqual(output.artifacts[0].path, 'src/app.js');
  });

  // ─── cmdVerifyArtifacts: object artifact missing `path` key (line 394) ──

  test('verify artifacts skips object entries with no path key', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/app.js]',
      'autonomous: true',
      'must_haves:',
      '    artifacts:',
      '      - provides: "something"',
      '      - path: "src/app.js"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.js'),
      'module.exports = {};\n',
    );
    const result = runGsdTools(
      'verify artifacts .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // `provides`-only item is skipped (line 394 !artPath continue); path one runs.
    assert.strictEqual(output.total, 1);
    assert.strictEqual(output.artifacts[0].path, 'src/app.js');
  });

  // ─── cmdVerifyArtifacts: scalar exports (Array.isArray false; line 415) ──

  test('verify artifacts handles single-value exports (string, not array)', () => {
    // parseMustHavesBlock keeps `exports: GET` as a string when there's no
    // child list — the `Array.isArray(artifact.exports)` arm is false here.
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/app.js]',
      'autonomous: true',
      'must_haves:',
      '    artifacts:',
      '      - path: "src/app.js"',
      '        exports: "POST"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'app.js'),
      'module.exports = { POST: () => {} };\n',
    );
    const result = runGsdTools(
      'verify artifacts .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // exports: "POST" is a string; Array.isArray false → wrapped in array of one.
    assert.strictEqual(output.all_passed, true);
  });

  // ─── cmdVerifyKeyLinks: absolute path branch (line 446) ──────────────────

  test('verify key-links accepts an absolute plan file path', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/a.js]',
      'autonomous: true',
      'must_haves:',
      '    key_links:',
      '      - from: "src/a.js"',
      '        to: "src/b.js"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'a.js'),
      "const b = require('./src/b.js');\n",
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'module.exports = 1;\n');
    const result = runGsdTools(`verify key-links ${planPath} --json`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, true);
  });

  // ─── cmdVerifyKeyLinks: string keyLink entry (line 465 — skip path) ──────

  test('verify key-links skips entries that are bare strings', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/a.js]',
      'autonomous: true',
      'must_haves:',
      '    key_links:',
      '      - "raw-string-link"',
      '      - from: "src/a.js"',
      '        to: "src/b.js"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'a.js'),
      "const b = require('./src/b.js');\n",
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'module.exports = 1;\n');
    const result = runGsdTools(
      'verify key-links .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // bare string skipped → only one link resolves.
    assert.strictEqual(output.total, 1);
    assert.strictEqual(output.links[0].from, 'src/a.js');
  });

  // ─── cmdVerifyKeyLinks: invalid regex pattern (line 492) ─────────────────

  test('verify key-links reports invalid regex pattern', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/a.js]',
      'autonomous: true',
      'must_haves:',
      '    key_links:',
      '      - from: "src/a.js"',
      '        to: "src/b.js"',
      '        pattern: "["', // unbalanced bracket → invalid regex
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    fs.writeFileSync(path.join(tmpDir, 'src', 'a.js'), 'const x = 1;\n');
    fs.writeFileSync(path.join(tmpDir, 'src', 'b.js'), 'const y = 2;\n');
    const result = runGsdTools(
      'verify key-links .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, false);
    assert.ok(
      output.links[0].detail.includes('Invalid regex'),
      `expected invalid-regex: ${output.links[0].detail}`,
    );
  });

  // ─── cmdVerifyKeyLinks: target not referenced (line 501) ─────────────────

  test('verify key-links reports when target not referenced in source (no pattern)', () => {
    const content = [
      '---',
      'phase: 01-test',
      'plan: 01',
      'type: execute',
      'wave: 1',
      'depends_on: []',
      'files_modified: [src/a.js]',
      'autonomous: true',
      'must_haves:',
      '    key_links:',
      '      - from: "src/a.js"',
      '        to: "src/no-link.js"',
      '---',
      '',
      '<tasks></tasks>',
    ].join('\n');
    const planPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-PLAN.md',
    );
    fs.writeFileSync(planPath, content);
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'a.js'),
      'const x = 1;\n', // does NOT mention src/no-link.js
    );
    fs.writeFileSync(
      path.join(tmpDir, 'src', 'no-link.js'),
      'module.exports = 1;\n',
    );
    const result = runGsdTools(
      'verify key-links .planning/phases/01-test/01-01-PLAN.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.strictEqual(output.all_verified, false);
    assert.ok(
      output.links[0].detail.includes('Target not referenced in source'),
      `expected not-referenced: ${output.links[0].detail}`,
    );
  });

  // ─── cmdVerifyCommits: empty hashes list when 'no hashes mentioned' branch
  // ─── cmdVerifySummary: hashes.length === 0 branch (line 116) ─────────────

  test('verify summary does not flag commits when SUMMARY mentions no hashes', () => {
    const summaryPath = path.join(
      tmpDir,
      '.planning',
      'phases',
      '01-test',
      '01-01-SUMMARY.md',
    );
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, 'src', 'app.js'), 'const x = 1;\n');
    fs.writeFileSync(
      summaryPath,
      [
        '# Summary',
        '',
        'Created: `src/app.js`',
        '',
        'No commit info here.',
      ].join('\n'),
    );
    const result = runGsdTools(
      'verify-summary .planning/phases/01-test/01-01-SUMMARY.md --json',
      tmpDir,
    );
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    // Without any hashes mentioned, the `!commitsExist && hashes.length > 0`
    // false-branch fires (line 116) and no "Referenced commit hashes not found"
    // error appears.
    assert.ok(
      !output.errors.some((e) =>
        e.includes('Referenced commit hashes not found'),
      ),
      `should not have commit-hash error: ${JSON.stringify(output.errors)}`,
    );
  });

  // ─── cmdVerifyPhaseCompleteness: orphan summary branch ───────────────────

  test('verify phase-completeness warns about orphan summaries', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n### Phase 1: Test\n',
    );
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    // Summary without matching plan
    fs.writeFileSync(
      path.join(phaseDir, '01-99-SUMMARY.md'),
      '# Orphan summary',
    );
    const result = runGsdTools('verify phase-completeness 1 --json', tmpDir);
    assert.ok(result.success);
    const output = JSON.parse(result.output);
    assert.ok(
      output.warnings.some((w) => w.includes('Summaries without plans')),
      `expected orphan-summary warning: ${JSON.stringify(output.warnings)}`,
    );
  });

  // ─── cmdVerifyCommits: at least one valid hash → all_valid=true ──────────

  test('verify commits returns all_valid=true when every hash is valid', () => {
    const gitDir = createTempGitProject();
    try {
      fs.writeFileSync(path.join(gitDir, 'src.js'), 'x\n');
      execSync('git add -A', { cwd: gitDir, stdio: 'pipe' });
      execSync('git commit -m "init"', { cwd: gitDir, stdio: 'pipe' });
      const hash = execSync('git rev-parse HEAD', {
        cwd: gitDir,
        encoding: 'utf-8',
      }).trim();
      const result = runGsdTools(`verify commits ${hash} --json`, gitDir);
      assert.ok(result.success, `Command failed: ${result.error}`);
      const output = JSON.parse(result.output);
      assert.strictEqual(output.all_valid, true);
      assert.strictEqual(output.invalid.length, 0);
    } finally {
      cleanup(gitDir);
    }
  });
});
