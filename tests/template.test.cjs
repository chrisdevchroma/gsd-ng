'use strict';

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');
const templateMod = require('../gsd-ng/bin/lib/template.cjs');

const TEMPLATE_LIB = path.resolve(
  __dirname,
  '..',
  'gsd-ng',
  'bin',
  'lib',
  'template.cjs',
);

// Direct-invocation helper for branches unreachable through validateArgs.
// Spawns a child Node process so the function's process.exit(1) (via error())
// is captured as the child's exit code, not the test runner's.
function spawnDirectFill(cwd, templateType, options) {
  const code =
    'const t = require(' +
    JSON.stringify(TEMPLATE_LIB) +
    '); t.cmdTemplateFill(' +
    JSON.stringify(cwd) +
    ', ' +
    (templateType === undefined ? 'undefined' : JSON.stringify(templateType)) +
    ', ' +
    JSON.stringify(options) +
    ');';
  const r = spawnSync(process.execPath, ['-e', code], { encoding: 'utf-8' });
  return {
    status: r.status,
    stdout: (r.stdout || '').trim(),
    stderr: (r.stderr || '').trim(),
  };
}

// cmdTemplateSelect and cmdTemplateFill use output()/error() helpers from
// core.cjs that write to stdout and call process.exit(1) respectively. Tests
// invoke the public CLI surface (runGsdTools) so process.exit and stdout are
// observed without tearing down the test runner. The --json flag forces
// output() to emit JSON regardless of the displayValue argument.
// The require() above also pins the module's export shape — tests below assert
// the public surface contains both expected functions.

function selectJSON(tmpDir, planPath) {
  const args = ['template', 'select'];
  if (planPath !== undefined) args.push(planPath);
  args.push('--json');
  const r = runGsdTools(args, tmpDir);
  if (!r.success) return r;
  return { ...r, json: JSON.parse(r.output) };
}

describe('cmdTemplateSelect', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Export shape — pins both public functions even though all behavior tests
  // exercise them through the CLI subprocess.
  test('module exports cmdTemplateSelect as a function', () => {
    assert.strictEqual(typeof templateMod.cmdTemplateSelect, 'function');
  });

  // Test A1: !planPath guard
  test('exits non-zero when planPath is missing', () => {
    const r = selectJSON(tmpDir, undefined);
    assert.strictEqual(r.success, false);
    assert.match(r.error || r.stderr || '', /plan-path required/);
  });

  // Test A2: file-not-found catch — fallback to standard
  test('returns standard fallback when plan file does not exist', () => {
    const r = selectJSON(tmpDir, 'does-not-exist.md');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.type, 'standard');
    assert.strictEqual(r.json.template, 'templates/summary-standard.md');
    assert.match(r.json.error, /ENOENT/);
  });

  // Test A3: minimal template — taskCount<=2, fileCount<=3, !hasDecisions
  test("returns 'minimal' when tasks <=2, files <=3, no decisions", () => {
    const planContent = [
      '# Plan',
      '',
      '### Task 1: Do X',
      '',
      'Some text mentioning `src/foo.ts`.',
      '',
      '### Task 2: Do Y',
      '',
      'More text mentioning `src/bar.ts`.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), planContent, 'utf-8');
    const r = selectJSON(tmpDir, 'plan.md');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.type, 'minimal');
    assert.strictEqual(r.json.taskCount, 2);
    assert.strictEqual(r.json.fileCount, 2);
    assert.strictEqual(r.json.hasDecisions, false);
  });

  // Test A4: complex template — taskCount > 5
  test("returns 'complex' when taskCount > 5", () => {
    const tasks = [];
    for (let i = 1; i <= 7; i++) tasks.push(`### Task ${i}: Item ${i}`);
    const planContent = '# Plan\n\n' + tasks.join('\n\n') + '\n';
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), planContent, 'utf-8');
    const r = selectJSON(tmpDir, 'plan.md');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.type, 'complex');
    assert.ok(r.json.taskCount > 5);
  });

  // Test A5: complex template — fileCount > 6
  test("returns 'complex' when fileCount > 6", () => {
    const files = [];
    for (let i = 1; i <= 8; i++) files.push(`\`src/mod${i}/file${i}.ts\``);
    const planContent =
      '# Plan\n\n### Task 1: Build it\n\n' + files.join(' ') + '\n';
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), planContent, 'utf-8');
    const r = selectJSON(tmpDir, 'plan.md');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.type, 'complex');
    assert.ok(r.json.fileCount > 6);
  });

  // Test A6: complex template — hasDecisions
  test("returns 'complex' when content mentions a decision", () => {
    const planContent = [
      '# Plan',
      '',
      '### Task 1: Implement',
      '',
      '## Decisions',
      '',
      '- Picked option A.',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), planContent, 'utf-8');
    const r = selectJSON(tmpDir, 'plan.md');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.type, 'complex');
    assert.strictEqual(r.json.hasDecisions, true);
  });

  // Test A7: standard middle case — 3-5 tasks, 4-6 files, no decisions
  test("returns 'standard' for the middle range", () => {
    const planContent = [
      '# Plan',
      '',
      '### Task 1: a',
      '### Task 2: b',
      '### Task 3: c',
      '### Task 4: d',
      '',
      'Files: `src/a.ts` `src/b.ts` `src/c.ts` `src/d.ts` `src/e.ts`',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), planContent, 'utf-8');
    const r = selectJSON(tmpDir, 'plan.md');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.type, 'standard');
    assert.strictEqual(r.json.taskCount, 4);
    assert.strictEqual(r.json.fileCount, 5);
    assert.strictEqual(r.json.hasDecisions, false);
  });

  // Test A8: fileMentions deduplication
  test('deduplicates repeated file mentions in fileCount', () => {
    const planContent = [
      '# Plan',
      '',
      '### Task 1: Do X',
      '',
      '`src/foo.ts` `src/foo.ts` `src/foo.ts` `src/foo.ts` `src/foo.ts`',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), planContent, 'utf-8');
    const r = selectJSON(tmpDir, 'plan.md');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.fileCount, 1);
    assert.strictEqual(r.json.type, 'minimal');
  });

  // Test A9: URL exclusion from fileCount
  test('excludes http(s) URLs from fileCount', () => {
    const planContent = [
      '# Plan',
      '',
      '### Task 1: Read links',
      '',
      'Links: `https://example.com/x.html` `http://foo.com/y.css`',
      '',
    ].join('\n');
    fs.writeFileSync(path.join(tmpDir, 'plan.md'), planContent, 'utf-8');
    const r = selectJSON(tmpDir, 'plan.md');
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.fileCount, 0);
    assert.strictEqual(r.json.type, 'minimal');
  });
});

function fillJSON(tmpDir, templateType, flags) {
  const args = ['template', 'fill'];
  if (templateType !== undefined) args.push(templateType);
  for (const [k, v] of Object.entries(flags || {})) {
    args.push(`--${k}`);
    args.push(String(v));
  }
  args.push('--json');
  const r = runGsdTools(args, tmpDir);
  if (!r.success) return r;
  let json = null;
  try {
    json = JSON.parse(r.output);
  } catch {
    /* non-JSON output (e.g. displayValue path) — leave json null */
  }
  return { ...r, json };
}

describe('cmdTemplateFill', () => {
  let tmpDir;
  let phaseDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Export shape
  test('module exports cmdTemplateFill as a function', () => {
    assert.strictEqual(typeof templateMod.cmdTemplateFill, 'function');
  });

  // Test B1: !templateType guard (unreachable from CLI — validateArgs blocks)
  test('errors when templateType is missing (direct invocation)', () => {
    const r = spawnDirectFill(tmpDir, undefined, { phase: '01' });
    assert.strictEqual(r.status, 1);
    assert.match(
      r.stderr,
      /template type required: summary, plan, or verification/,
    );
  });

  // Test B2: !options.phase guard (reachable via missing --phase)
  test('errors when --phase flag is missing', () => {
    const r = fillJSON(tmpDir, 'summary', {});
    assert.strictEqual(r.success, false);
    assert.match(r.error || r.stderr || '', /--phase required/);
  });

  // Test B3: phase not found
  test("returns { error: 'Phase not found' } when phase directory absent", () => {
    const r = fillJSON(tmpDir, 'summary', { phase: '99' });
    assert.strictEqual(r.success, true);
    assert.ok(r.json, 'expected JSON output');
    assert.strictEqual(r.json.error, 'Phase not found');
    assert.strictEqual(r.json.phase, '99');
  });

  // Test B4: summary success
  test('writes SUMMARY.md with frontmatter for templateType=summary', () => {
    const r = fillJSON(tmpDir, 'summary', { phase: '01' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.created, true);
    assert.strictEqual(r.json.template, 'summary');
    const expectedPath = path.join(phaseDir, '01-01-SUMMARY.md');
    assert.ok(fs.existsSync(expectedPath), 'expected SUMMARY.md to be written');
    const body = fs.readFileSync(expectedPath, 'utf-8');
    assert.match(body, /^---\n/, 'has frontmatter open marker');
    assert.match(body, /\nphase: 01-test/);
    assert.match(body, /\nplan: 01/);
    assert.match(body, /# Phase 01: test Summary/);
  });

  // Test B5: plan default (type=execute, wave=1, plan=01)
  test('writes PLAN.md for templateType=plan with default options', () => {
    const r = fillJSON(tmpDir, 'plan', { phase: '01' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.created, true);
    assert.strictEqual(r.json.template, 'plan');
    const expectedPath = path.join(phaseDir, '01-01-PLAN.md');
    assert.ok(fs.existsSync(expectedPath));
    const body = fs.readFileSync(expectedPath, 'utf-8');
    assert.match(body, /\ntype: execute/);
    assert.match(body, /\nwave: 1/);
  });

  // Test B6: plan with explicit type/wave/plan number
  test('honors --type, --wave, --plan flags for templateType=plan', () => {
    const r = fillJSON(tmpDir, 'plan', {
      phase: '01',
      plan: '02',
      type: 'tdd',
      wave: '3',
    });
    assert.strictEqual(r.success, true);
    const expectedPath = path.join(phaseDir, '01-02-PLAN.md');
    assert.ok(fs.existsSync(expectedPath));
    const body = fs.readFileSync(expectedPath, 'utf-8');
    assert.match(body, /\ntype: tdd/);
    assert.match(body, /\nwave: 3/);
    assert.match(body, /\nplan: 02/);
  });

  // Test B7: verification
  test('writes VERIFICATION.md for templateType=verification', () => {
    const r = fillJSON(tmpDir, 'verification', { phase: '01' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.created, true);
    assert.strictEqual(r.json.template, 'verification');
    const expectedPath = path.join(phaseDir, '01-VERIFICATION.md');
    assert.ok(fs.existsSync(expectedPath));
    const body = fs.readFileSync(expectedPath, 'utf-8');
    assert.match(body, /\nstatus: pending/);
    assert.match(body, /## Observable Truths/);
  });

  // Test B8: unknown templateType — default switch branch
  test('errors for unknown templateType', () => {
    const r = fillJSON(tmpDir, 'unknown-type', { phase: '01' });
    assert.strictEqual(r.success, false);
    assert.match(r.error || r.stderr || '', /Unknown template type/);
  });

  // Test B9: file-already-exists guard
  test("returns { error: 'File already exists' } when target file exists", () => {
    const target = path.join(phaseDir, '01-01-SUMMARY.md');
    fs.writeFileSync(target, '# pre-existing\n', 'utf-8');
    const r = fillJSON(tmpDir, 'summary', { phase: '01' });
    assert.strictEqual(r.success, true);
    assert.ok(r.json, 'expected JSON output');
    assert.strictEqual(r.json.error, 'File already exists');
    assert.match(r.json.path, /01-01-SUMMARY\.md$/);
    // File body must NOT have been overwritten
    assert.strictEqual(fs.readFileSync(target, 'utf-8'), '# pre-existing\n');
  });

  // Additional: --name flag overrides phase_name
  test('honors --name flag in summary frontmatter', () => {
    const r = fillJSON(tmpDir, 'summary', {
      phase: '01',
      name: 'Custom Name',
    });
    assert.strictEqual(r.success, true);
    const body = fs.readFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      'utf-8',
    );
    assert.match(body, /# Phase 01: Custom Name Summary/);
  });

  // Additional: --fields JSON merges into frontmatter (covers options.fields path)
  test('merges --fields JSON into frontmatter for plan templateType', () => {
    const r = fillJSON(tmpDir, 'plan', {
      phase: '01',
      fields: '{"subsystem":"testing"}',
    });
    assert.strictEqual(r.success, true);
    const body = fs.readFileSync(
      path.join(phaseDir, '01-01-PLAN.md'),
      'utf-8',
    );
    assert.match(body, /\nsubsystem: testing/);
  });

  // Additional: phase without slug-extractable name (no dash suffix in dir)
  test('handles phase directory with no name suffix (uses generated slug)', () => {
    // Create a phase directory that's just '02' with no suffix.
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02'), {
      recursive: true,
    });
    const r = fillJSON(tmpDir, 'summary', { phase: '02' });
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.json.created, true);
    // Generated slug from 'Unnamed' default name — written file path comes back
    assert.match(r.json.path, /02-01-SUMMARY\.md$/);
  });
});

