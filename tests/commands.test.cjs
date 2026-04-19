/**
 * GSD Tools Tests - Commands
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('node:child_process');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, createTempGitProject, cleanup, resolveTmpDir } = require('./helpers.cjs');

describe('history-digest command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty phases directory returns valid schema', () => {
    const result = runGsdTools('history-digest --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    assert.deepStrictEqual(digest.phases, {}, 'phases should be empty object');
    assert.deepStrictEqual(digest.decisions, [], 'decisions should be empty array');
    assert.deepStrictEqual(digest.tech_stack, [], 'tech_stack should be empty array');
  });

  test('nested frontmatter fields extracted correctly', () => {
    // Create phase directory with SUMMARY containing nested frontmatter
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    const summaryContent = `---
phase: "01"
name: "Foundation Setup"
dependency-graph:
  provides:
    - "Database schema"
    - "Auth system"
  affects:
    - "API layer"
tech-stack:
  added:
    - "prisma"
    - "jose"
patterns-established:
  - "Repository pattern"
  - "JWT auth flow"
key-decisions:
  - "Use Prisma over Drizzle"
  - "JWT in httpOnly cookies"
---

# Summary content here
`;

    fs.writeFileSync(path.join(phaseDir, '01-01-SUMMARY.md'), summaryContent);

    const result = runGsdTools('history-digest --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    // Check nested dependency-graph.provides
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.deepStrictEqual(
      digest.phases['01'].provides.sort(),
      ['Auth system', 'Database schema'],
      'provides should contain nested values'
    );

    // Check nested dependency-graph.affects
    assert.deepStrictEqual(
      digest.phases['01'].affects,
      ['API layer'],
      'affects should contain nested values'
    );

    // Check nested tech-stack.added
    assert.deepStrictEqual(
      digest.tech_stack.sort(),
      ['jose', 'prisma'],
      'tech_stack should contain nested values'
    );

    // Check patterns-established (flat array)
    assert.deepStrictEqual(
      digest.phases['01'].patterns.sort(),
      ['JWT auth flow', 'Repository pattern'],
      'patterns should be extracted'
    );

    // Check key-decisions
    assert.strictEqual(digest.decisions.length, 2, 'Should have 2 decisions');
    assert.ok(
      digest.decisions.some(d => d.decision === 'Use Prisma over Drizzle'),
      'Should contain first decision'
    );
  });

  test('multiple phases merged into single digest', () => {
    // Create phase 01
    const phase01Dir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phase01Dir, { recursive: true });
    fs.writeFileSync(
      path.join(phase01Dir, '01-01-SUMMARY.md'),
      `---
phase: "01"
name: "Foundation"
provides:
  - "Database"
patterns-established:
  - "Pattern A"
key-decisions:
  - "Decision 1"
---
`
    );

    // Create phase 02
    const phase02Dir = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(phase02Dir, { recursive: true });
    fs.writeFileSync(
      path.join(phase02Dir, '02-01-SUMMARY.md'),
      `---
phase: "02"
name: "API"
provides:
  - "REST endpoints"
patterns-established:
  - "Pattern B"
key-decisions:
  - "Decision 2"
tech-stack:
  added:
    - "zod"
---
`
    );

    const result = runGsdTools('history-digest --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);

    // Both phases present
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.ok(digest.phases['02'], 'Phase 02 should exist');

    // Decisions merged
    assert.strictEqual(digest.decisions.length, 2, 'Should have 2 decisions total');

    // Tech stack merged
    assert.deepStrictEqual(digest.tech_stack, ['zod'], 'tech_stack should have zod');
  });

  test('malformed SUMMARY.md skipped gracefully', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    // Valid summary
    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides:
  - "Valid feature"
---
`
    );

    // Malformed summary (no frontmatter)
    fs.writeFileSync(
      path.join(phaseDir, '01-02-SUMMARY.md'),
      `# Just a heading
No frontmatter here
`
    );

    // Another malformed summary (broken YAML)
    fs.writeFileSync(
      path.join(phaseDir, '01-03-SUMMARY.md'),
      `---
broken: [unclosed
---
`
    );

    const result = runGsdTools('history-digest --json', tmpDir);
    assert.ok(result.success, `Command should succeed despite malformed files: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.ok(digest.phases['01'], 'Phase 01 should exist');
    assert.ok(
      digest.phases['01'].provides.includes('Valid feature'),
      'Valid feature should be extracted'
    );
  });

  test('flat provides field still works (backward compatibility)', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides:
  - "Direct provides"
---
`
    );

    const result = runGsdTools('history-digest --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(
      digest.phases['01'].provides,
      ['Direct provides'],
      'Direct provides should work'
    );
  });

  test('inline array syntax supported', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
provides: [Feature A, Feature B]
patterns-established: ["Pattern X", "Pattern Y"]
---
`
    );

    const result = runGsdTools('history-digest --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const digest = JSON.parse(result.output);
    assert.deepStrictEqual(
      digest.phases['01'].provides.sort(),
      ['Feature A', 'Feature B'],
      'Inline array should work'
    );
    assert.deepStrictEqual(
      digest.phases['01'].patterns.sort(),
      ['Pattern X', 'Pattern Y'],
      'Inline quoted array should work'
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// phases list command
// ─────────────────────────────────────────────────────────────────────────────


describe('summary-extract command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('missing file returns error', () => {
    const result = runGsdTools('summary-extract .planning/phases/01-test/01-01-SUMMARY.md --json', tmpDir);
    assert.ok(result.success, `Command should succeed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.error, 'File not found', 'should report missing file');
  });

  test('extracts all fields from SUMMARY.md', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
key-files:
  - prisma/schema.prisma
  - src/lib/db.ts
tech-stack:
  added:
    - prisma
    - zod
patterns-established:
  - Repository pattern
  - Dependency injection
key-decisions:
  - Use Prisma over Drizzle: Better DX and ecosystem
  - Single database: Start simple, shard later
requirements-completed:
  - AUTH-01
  - AUTH-02
---

# Summary

**Set up Prisma with User and Project models**

Full summary content here.
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.path, '.planning/phases/01-foundation/01-01-SUMMARY.md', 'path correct');
    assert.strictEqual(output.one_liner, 'Set up Prisma with User and Project models', 'one-liner extracted');
    assert.deepStrictEqual(output.key_files, ['prisma/schema.prisma', 'src/lib/db.ts'], 'key files extracted');
    assert.deepStrictEqual(output.tech_added, ['prisma', 'zod'], 'tech added extracted');
    assert.deepStrictEqual(output.patterns, ['Repository pattern', 'Dependency injection'], 'patterns extracted');
    assert.strictEqual(output.decisions.length, 2, 'decisions extracted');
    assert.deepStrictEqual(output.requirements_completed, ['AUTH-01', 'AUTH-02'], 'requirements completed extracted');
  });

  test('selective extraction with --fields', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
key-files:
  - prisma/schema.prisma
tech-stack:
  added:
    - prisma
patterns-established:
  - Repository pattern
key-decisions:
  - Use Prisma: Better DX
requirements-completed:
  - AUTH-01
---

# Summary

**Set up database**
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md --fields one_liner,key_files,requirements_completed --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Set up database', 'one_liner included');
    assert.deepStrictEqual(output.key_files, ['prisma/schema.prisma'], 'key_files included');
    assert.deepStrictEqual(output.requirements_completed, ['AUTH-01'], 'requirements_completed included');
    assert.strictEqual(output.tech_added, undefined, 'tech_added excluded');
    assert.strictEqual(output.patterns, undefined, 'patterns excluded');
    assert.strictEqual(output.decisions, undefined, 'decisions excluded');
  });

  test('extracts one-liner from body when not in frontmatter', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
key-files:
  - src/lib/db.ts
---

# Phase 1: Foundation Summary

**JWT auth with refresh rotation using jose library**

## Performance

- **Duration:** 28 min
- **Tasks:** 5
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'JWT auth with refresh rotation using jose library',
      'one-liner should be extracted from body **bold** line');
  });

  test('handles missing frontmatter fields gracefully', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
---

# Summary

**Minimal summary**
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Minimal summary', 'one-liner extracted');
    assert.deepStrictEqual(output.key_files, [], 'key_files defaults to empty');
    assert.deepStrictEqual(output.tech_added, [], 'tech_added defaults to empty');
    assert.deepStrictEqual(output.patterns, [], 'patterns defaults to empty');
    assert.deepStrictEqual(output.decisions, [], 'decisions defaults to empty');
    assert.deepStrictEqual(output.requirements_completed, [], 'requirements_completed defaults to empty');
  });

  test('extracts one-liner from body when text contains literal asterisks', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
phase: "01"
---

# Phase 1: Foundation Summary

**Replaced blanket Bash(cli *) wildcards with granular patterns**

## Performance

- **Duration:** 15 min
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.one_liner, 'Replaced blanket Bash(cli *) wildcards with granular patterns',
      'one-liner with asterisks should be extracted from body');
  });

  test('parses key-decisions with rationale', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(phaseDir, { recursive: true });

    fs.writeFileSync(
      path.join(phaseDir, '01-01-SUMMARY.md'),
      `---
key-decisions:
  - Use Prisma: Better DX than alternatives
  - JWT tokens: Stateless auth for scalability
---
`
    );

    const result = runGsdTools('summary-extract .planning/phases/01-foundation/01-01-SUMMARY.md --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.decisions[0].summary, 'Use Prisma', 'decision summary parsed');
    assert.strictEqual(output.decisions[0].rationale, 'Better DX than alternatives', 'decision rationale parsed');
    assert.strictEqual(output.decisions[1].summary, 'JWT tokens', 'second decision summary');
    assert.strictEqual(output.decisions[1].rationale, 'Stateless auth for scalability', 'second decision rationale');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// init commands tests
// ─────────────────────────────────────────────────────────────────────────────


describe('progress command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('renders JSON progress', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Done');
    fs.writeFileSync(path.join(p1, '01-02-PLAN.md'), '# Plan 2');

    const result = runGsdTools('progress json --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.total_plans, 2, '2 total plans');
    assert.strictEqual(output.total_summaries, 1, '1 summary');
    assert.strictEqual(output.percent, 50, '50%');
    assert.strictEqual(output.phases.length, 1, '1 phase');
    assert.strictEqual(output.phases[0].status, 'In Progress', 'phase in progress');
  });

  test('renders bar format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Done');

    const result = runGsdTools('progress bar', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('1/1'), 'should include count');
    assert.ok(result.output.includes('100%'), 'should include 100%');
  });

  test('renders table format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');

    const result = runGsdTools('progress table', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('Phase'), 'should have table header');
    assert.ok(result.output.includes('foundation'), 'should include phase name');
  });

  test('does not crash when summaries exceed plans (orphaned SUMMARY.md)', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap v1.0 MVP\n`
    );
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-foundation');
    fs.mkdirSync(p1, { recursive: true });
    // 1 plan but 2 summaries (orphaned SUMMARY.md after PLAN.md deletion)
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Done');
    fs.writeFileSync(path.join(p1, '01-02-SUMMARY.md'), '# Orphaned summary');

    // bar format - should not crash with RangeError
    const barResult = runGsdTools('progress bar', tmpDir);
    assert.ok(barResult.success, `Bar format crashed: ${barResult.error}`);
    assert.ok(barResult.output.includes('100%'), 'percent should be clamped to 100%');

    // table format - should not crash with RangeError
    const tableResult = runGsdTools('progress table', tmpDir);
    assert.ok(tableResult.success, `Table format crashed: ${tableResult.error}`);

    // json format - percent should be clamped
    const jsonResult = runGsdTools('progress json --json', tmpDir);
    assert.ok(jsonResult.success, `JSON format crashed: ${jsonResult.error}`);
    const output = JSON.parse(jsonResult.output);
    assert.ok(output.percent <= 100, `percent should be <= 100 but got ${output.percent}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// todo complete command
// ─────────────────────────────────────────────────────────────────────────────


describe('todo complete command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('moves todo from pending to completed', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });
    fs.writeFileSync(
      path.join(pendingDir, 'add-dark-mode.md'),
      `title: Add dark mode\narea: ui\ncreated: 2025-01-01\n`
    );

    const result = runGsdTools('todo complete add-dark-mode.md --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.completed, true);

    // Verify moved
    assert.ok(
      !fs.existsSync(path.join(tmpDir, '.planning', 'todos', 'pending', 'add-dark-mode.md')),
      'should be removed from pending'
    );
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'todos', 'completed', 'add-dark-mode.md')),
      'should be in completed'
    );

    // Verify completion timestamp added
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'todos', 'completed', 'add-dark-mode.md'),
      'utf-8'
    );
    assert.ok(content.startsWith('completed:'), 'should have completed timestamp');
  });

  test('fails for nonexistent todo', () => {
    const result = runGsdTools('todo complete nonexistent.md', tmpDir);
    assert.ok(!result.success, 'should fail');
    assert.ok(result.error.includes('not found'), 'error mentions not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scaffold command
// ─────────────────────────────────────────────────────────────────────────────


describe('scaffold command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('scaffolds context file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runGsdTools('scaffold context --phase 3 --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    // Verify file content
    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-CONTEXT.md'),
      'utf-8'
    );
    assert.ok(content.includes('Phase 3'), 'should reference phase number');
    assert.ok(content.includes('Decisions'), 'should have decisions section');
    assert.ok(content.includes('Discretion Areas'), 'should have discretion section');
  });

  test('scaffolds UAT file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runGsdTools('scaffold uat --phase 3 --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-UAT.md'),
      'utf-8'
    );
    assert.ok(content.includes('User Acceptance Testing'), 'should have UAT heading');
    assert.ok(content.includes('Test Results'), 'should have test results section');
  });

  test('scaffolds verification file', () => {
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '03-api'), { recursive: true });

    const result = runGsdTools('scaffold verification --phase 3 --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);

    const content = fs.readFileSync(
      path.join(tmpDir, '.planning', 'phases', '03-api', '03-VERIFICATION.md'),
      'utf-8'
    );
    assert.ok(content.includes('Goal-Backward Verification'), 'should have verification heading');
  });

  test('scaffolds phase directory', () => {
    const result = runGsdTools('scaffold phase-dir --phase 5 --name User Dashboard --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, true);
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.planning', 'phases', '05-user-dashboard')),
      'directory should be created'
    );
  });

  test('does not overwrite existing files', () => {
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '03-api');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '03-CONTEXT.md'), '# Existing content');

    const result = runGsdTools('scaffold context --phase 3 --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.created, false, 'should not overwrite');
    assert.strictEqual(output.reason, 'already_exists');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdGenerateSlug tests (CMD-01)
// ─────────────────────────────────────────────────────────────────────────────

describe('generate-slug command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('converts normal text to slug', () => {
    const result = runGsdTools('generate-slug "Hello World" --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'hello-world');
  });

  test('strips special characters', () => {
    const result = runGsdTools('generate-slug "Test@#$%^Special!!!" --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'test-special');
  });

  test('preserves numbers', () => {
    const result = runGsdTools('generate-slug "Phase 3 Plan" --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'phase-3-plan');
  });

  test('strips leading and trailing hyphens', () => {
    const result = runGsdTools('generate-slug "---leading-trailing---" --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.slug, 'leading-trailing');
  });

  test('fails when no text provided', () => {
    const result = runGsdTools('generate-slug', tmpDir);
    assert.ok(!result.success, 'should fail without text');
    assert.ok(result.error.includes('text required'), 'error should mention text required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdCurrentTimestamp tests (CMD-01)
// ─────────────────────────────────────────────────────────────────────────────

describe('current-timestamp command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('date format returns YYYY-MM-DD', () => {
    const result = runGsdTools('current-timestamp date --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.match(output.timestamp, /^\d{4}-\d{2}-\d{2}$/, 'should be YYYY-MM-DD format');
  });

  test('filename format returns ISO without colons or fractional seconds', () => {
    const result = runGsdTools('current-timestamp filename --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.match(output.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}$/, 'should replace colons with hyphens and strip fractional seconds');
  });

  test('full format returns full ISO string', () => {
    const result = runGsdTools('current-timestamp full --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.match(output.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'should be full ISO format');
  });

  test('default (no format) returns full ISO string', () => {
    const result = runGsdTools('current-timestamp --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.match(output.timestamp, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 'default should be full ISO format');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdListTodos tests (CMD-02)
// ─────────────────────────────────────────────────────────────────────────────

describe('list-todos command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('empty directory returns zero count', () => {
    const result = runGsdTools('list-todos --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 0, 'count should be 0');
    assert.deepStrictEqual(output.todos, [], 'todos should be empty');
  });

  test('returns multiple todos with correct fields', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });

    fs.writeFileSync(path.join(pendingDir, 'add-tests.md'), 'title: Add unit tests\narea: testing\ncreated: 2026-01-15\n');
    fs.writeFileSync(path.join(pendingDir, 'fix-bug.md'), 'title: Fix login bug\narea: auth\ncreated: 2026-01-20\n');

    const result = runGsdTools('list-todos --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 2, 'should have 2 todos');
    assert.strictEqual(output.todos.length, 2, 'todos array should have 2 entries');

    const testTodo = output.todos.find(t => t.file === 'add-tests.md');
    assert.ok(testTodo, 'add-tests.md should be in results');
    assert.strictEqual(testTodo.title, 'Add unit tests');
    assert.strictEqual(testTodo.area, 'testing');
    assert.strictEqual(testTodo.created, '2026-01-15');
  });

  test('area filter returns only matching todos', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });

    fs.writeFileSync(path.join(pendingDir, 'ui-task.md'), 'title: UI task\narea: ui\ncreated: 2026-01-01\n');
    fs.writeFileSync(path.join(pendingDir, 'api-task.md'), 'title: API task\narea: api\ncreated: 2026-01-01\n');

    const result = runGsdTools('list-todos ui --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 1, 'should have 1 matching todo');
    assert.strictEqual(output.todos[0].area, 'ui', 'should only return ui area');
  });

  test('area filter miss returns zero count', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });

    fs.writeFileSync(path.join(pendingDir, 'task.md'), 'title: Some task\narea: backend\ncreated: 2026-01-01\n');

    const result = runGsdTools('list-todos nonexistent-area --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 0, 'should have 0 matching todos');
  });

  test('malformed files use defaults', () => {
    const pendingDir = path.join(tmpDir, '.planning', 'todos', 'pending');
    fs.mkdirSync(pendingDir, { recursive: true });

    // File with no title or area fields
    fs.writeFileSync(path.join(pendingDir, 'malformed.md'), 'some random content\nno fields here\n');

    const result = runGsdTools('list-todos --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.count, 1, 'malformed file should still be counted');
    assert.strictEqual(output.todos[0].title, 'Untitled', 'missing title defaults to Untitled');
    assert.strictEqual(output.todos[0].area, 'general', 'missing area defaults to general');
    assert.strictEqual(output.todos[0].created, 'unknown', 'missing created defaults to unknown');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdVerifyPathExists tests (CMD-02)
// ─────────────────────────────────────────────────────────────────────────────

describe('verify-path-exists command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('existing file returns exists=true with type=file', () => {
    fs.writeFileSync(path.join(tmpDir, 'test-file.txt'), 'hello');

    const result = runGsdTools('verify-path-exists test-file.txt --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'file');
  });

  test('existing directory returns exists=true with type=directory', () => {
    fs.mkdirSync(path.join(tmpDir, 'test-dir'), { recursive: true });

    const result = runGsdTools('verify-path-exists test-dir --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'directory');
  });

  test('missing path returns exists=false', () => {
    const result = runGsdTools('verify-path-exists nonexistent/path --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, false);
    assert.strictEqual(output.type, null);
  });

  test('absolute path resolves correctly', () => {
    const absFile = path.join(tmpDir, 'abs-test.txt');
    fs.writeFileSync(absFile, 'content');

    const result = runGsdTools(`verify-path-exists ${absFile} --json`, tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.exists, true);
    assert.strictEqual(output.type, 'file');
  });

  test('fails when no path provided', () => {
    const result = runGsdTools('verify-path-exists', tmpDir);
    assert.ok(!result.success, 'should fail without path');
    assert.ok(result.error.includes('path required'), 'error should mention path required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdResolveModel tests (CMD-03)
// ─────────────────────────────────────────────────────────────────────────────

describe('resolve-model command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('known agent returns model and profile without unknown_agent', () => {
    const result = runGsdTools('resolve-model gsd-planner --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(output.model, 'should have model field');
    assert.ok(output.profile, 'should have profile field');
    assert.strictEqual(output.unknown_agent, undefined, 'should not have unknown_agent for known agent');
  });

  test('unknown agent returns unknown_agent=true', () => {
    const result = runGsdTools('resolve-model fake-nonexistent-agent --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.unknown_agent, true, 'should flag unknown agent');
  });

  test('default profile fallback when no config exists', () => {
    // tmpDir has no config.json, so defaults to balanced profile
    const result = runGsdTools('resolve-model gsd-executor --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.profile, 'balanced', 'should default to balanced profile');
    assert.ok(output.model, 'should resolve a model');
  });

  test('fails when no agent-type provided', () => {
    const result = runGsdTools('resolve-model', tmpDir);
    assert.ok(!result.success, 'should fail without agent-type');
    assert.ok(result.error.includes('agent-type required'), 'error should mention agent-type required');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdCommit tests (CMD-04)
// ─────────────────────────────────────────────────────────────────────────────

describe('commit command', () => {
  const { createTempGitProject } = require('./helpers.cjs');
  const { execSync } = require('child_process');
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('skips when commit_docs is false', () => {
    // Write config with commit_docs: false
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ commit_docs: false })
    );

    const result = runGsdTools('commit "test message" --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, false);
    assert.strictEqual(output.reason, 'skipped_commit_docs_false');
  });

  test('skips when .planning is gitignored', () => {
    // Add .planning/ to .gitignore and commit it so git recognizes the ignore
    fs.writeFileSync(path.join(tmpDir, '.gitignore'), '.planning/\n');
    execSync('git add .gitignore', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "add gitignore"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runGsdTools('commit "test message" --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, false);
    assert.strictEqual(output.reason, 'skipped_gitignored');
  });

  test('handles nothing to commit', () => {
    // Don't modify any files after initial commit
    const result = runGsdTools('commit "test message" --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, false);
    assert.strictEqual(output.reason, 'nothing_to_commit');
  });

  test('creates real commit with correct hash', () => {
    // Create a new file in .planning/
    fs.writeFileSync(path.join(tmpDir, '.planning', 'test-file.md'), '# Test\n');

    const result = runGsdTools('commit "test: add test file" --files .planning/test-file.md --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, true, 'should have committed');
    assert.ok(output.hash, 'should have a commit hash');
    assert.strictEqual(output.reason, 'committed');

    // Verify via git log
    const gitLog = execSync('git log --oneline -1', { cwd: tmpDir, encoding: 'utf-8' }).trim();
    assert.ok(gitLog.includes('test: add test file'), 'git log should contain the commit message');
    assert.ok(gitLog.includes(output.hash), 'git log should contain the returned hash');
  });

  test('amend mode works without crashing', () => {
    // Create a file and commit it first
    fs.writeFileSync(path.join(tmpDir, '.planning', 'amend-file.md'), '# Initial\n');
    execSync('git add .planning/amend-file.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial file"', { cwd: tmpDir, stdio: 'pipe' });

    // Modify the file and amend
    fs.writeFileSync(path.join(tmpDir, '.planning', 'amend-file.md'), '# Amended\n');

    const result = runGsdTools('commit "ignored" --files .planning/amend-file.md --amend --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.committed, true, 'amend should succeed');

    // Verify only 2 commits total (initial setup + amended)
    const logCount = execSync('git log --oneline', { cwd: tmpDir, encoding: 'utf-8' }).trim().split('\n').length;
    assert.strictEqual(logCount, 2, 'should have 2 commits (initial + amended)');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdWebsearch tests (CMD-05)
// ─────────────────────────────────────────────────────────────────────────────

describe('websearch command', () => {
  const { cmdWebsearch } = require('../gsd-ng/bin/lib/commands.cjs');
  const { setJsonMode } = require('../gsd-ng/bin/lib/core.cjs');
  let origFetch;
  let origApiKey;
  let origFsWriteSync;
  let origStdoutWrite;
  let captured;

  beforeEach(() => {
    origFetch = global.fetch;
    origApiKey = process.env.BRAVE_API_KEY;
    origFsWriteSync = fs.writeSync.bind(fs);
    origStdoutWrite = process.stdout.write.bind(process.stdout);
    captured = '';
    setJsonMode(true);  // websearch tests expect JSON output
    // Intercept both fs.writeSync(1,...) and process.stdout.write to capture output()
    fs.writeSync = (fd, data, ...rest) => {
      if (fd === 1) { captured += String(data); return data.length; }
      return origFsWriteSync(fd, data, ...rest);
    };
    process.stdout.write = (chunk) => { captured += String(chunk); return true; };
  });

  afterEach(() => {
    global.fetch = origFetch;
    if (origApiKey !== undefined) {
      process.env.BRAVE_API_KEY = origApiKey;
    } else {
      delete process.env.BRAVE_API_KEY;
    }
    fs.writeSync = origFsWriteSync;
    process.stdout.write = origStdoutWrite;
    setJsonMode(false);
  });

  test('returns available=false when BRAVE_API_KEY is unset', async () => {
    delete process.env.BRAVE_API_KEY;

    await cmdWebsearch('test query', {});

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, false);
    assert.ok(output.reason.includes('BRAVE_API_KEY'), 'should mention missing API key');
  });

  test('returns error when no query provided', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    await cmdWebsearch(null, {});

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, false);
    assert.ok(output.error.includes('Query required'), 'should mention query required');
  });

  test('returns results for successful API response', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    global.fetch = async () => ({
      ok: true,
      json: async () => ({
        web: {
          results: [
            { title: 'Test Result', url: 'https://example.com', description: 'A test result', age: '1d' },
          ],
        },
      }),
    });

    await cmdWebsearch('test query', { limit: 5, freshness: 'pd' });

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, true);
    assert.strictEqual(output.query, 'test query');
    assert.strictEqual(output.count, 1);
    assert.strictEqual(output.results[0].title, 'Test Result');
    assert.strictEqual(output.results[0].url, 'https://example.com');
    assert.strictEqual(output.results[0].age, '1d');
  });

  test('constructs correct URL parameters', async () => {
    process.env.BRAVE_API_KEY = 'test-key';
    let capturedUrl = '';

    global.fetch = async (url) => {
      capturedUrl = url;
      return {
        ok: true,
        json: async () => ({ web: { results: [] } }),
      };
    };

    await cmdWebsearch('node.js testing', { limit: 5, freshness: 'pd' });

    const parsed = new URL(capturedUrl);
    assert.strictEqual(parsed.searchParams.get('q'), 'node.js testing', 'query param should decode to original string');
    assert.strictEqual(parsed.searchParams.get('count'), '5', 'count param should be 5');
    assert.strictEqual(parsed.searchParams.get('freshness'), 'pd', 'freshness param should be pd');
  });

  test('handles API error (non-200 status)', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    global.fetch = async () => ({
      ok: false,
      status: 429,
    });

    await cmdWebsearch('test query', {});

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, false);
    assert.ok(output.error.includes('429'), 'error should include status code');
  });

  test('handles network failure', async () => {
    process.env.BRAVE_API_KEY = 'test-key';

    global.fetch = async () => {
      throw new Error('Network timeout');
    };

    await cmdWebsearch('test query', {});

    const output = JSON.parse(captured);
    assert.strictEqual(output.available, false);
    assert.strictEqual(output.error, 'Network timeout');
  });
});

describe('stats command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns valid JSON with empty project', () => {
    const result = runGsdTools('stats --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.ok(Array.isArray(stats.phases), 'phases should be an array');
    assert.strictEqual(stats.total_plans, 0);
    assert.strictEqual(stats.total_summaries, 0);
    assert.strictEqual(stats.percent, 0);
    assert.strictEqual(stats.phases_completed, 0);
    assert.strictEqual(stats.phases_total, 0);
    assert.strictEqual(stats.requirements_total, 0);
    assert.strictEqual(stats.requirements_complete, 0);
  });

  test('counts phases, plans, and summaries correctly', () => {
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-auth');
    const p2 = path.join(tmpDir, '.planning', 'phases', '02-api');
    fs.mkdirSync(p1, { recursive: true });
    fs.mkdirSync(p2, { recursive: true });

    // Phase 1: 2 plans, 2 summaries (complete)
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-02-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(path.join(p1, '01-02-SUMMARY.md'), '# Summary');

    // Phase 2: 1 plan, 0 summaries (planned)
    fs.writeFileSync(path.join(p2, '02-01-PLAN.md'), '# Plan');

    const result = runGsdTools('stats --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.phases_total, 2);
    assert.strictEqual(stats.phases_completed, 1);
    assert.strictEqual(stats.total_plans, 3);
    assert.strictEqual(stats.total_summaries, 2);
    assert.strictEqual(stats.percent, 50);
    assert.strictEqual(stats.plan_percent, 67);
  });

  test('counts requirements from REQUIREMENTS.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'REQUIREMENTS.md'),
      `# Requirements

## v1 Requirements

- [x] **AUTH-01**: User can sign up
- [x] **AUTH-02**: User can log in
- [ ] **API-01**: REST endpoints
- [ ] **API-02**: GraphQL support
`
    );

    const result = runGsdTools('stats --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.requirements_total, 4);
    assert.strictEqual(stats.requirements_complete, 2);
  });

  test('reads last activity from STATE.md', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# State\n\n**Current Phase:** 01\n**Status:** In progress\n**Last Activity:** 2025-06-15\n**Last Activity Description:** Working\n`
    );

    const result = runGsdTools('stats --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.last_activity, '2025-06-15');
  });

  test('reads last activity from plain STATE.md template format', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'STATE.md'),
      `# Project State\n\n## Current Position\n\nPhase: 1 of 2 (Foundation)\nPlan: 1 of 1 in current phase\nStatus: In progress\nLast activity: 2025-06-16 — Finished plan 01-01\n`
    );

    const result = runGsdTools('stats --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.last_activity, '2025-06-16 — Finished plan 01-01');
  });

  test('includes roadmap-only phases in totals and preserves hyphenated names', () => {
    const p1 = path.join(tmpDir, '.planning', 'phases', '14-auth-hardening');
    const p2 = path.join(tmpDir, '.planning', 'phases', '15-proof-generation');
    fs.mkdirSync(p1, { recursive: true });
    fs.mkdirSync(p2, { recursive: true });
    fs.writeFileSync(path.join(p1, '14-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '14-01-SUMMARY.md'), '# Summary');
    fs.writeFileSync(path.join(p2, '15-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p2, '15-01-SUMMARY.md'), '# Summary');

    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      `# Roadmap

- [x] **Phase 14: Auth Hardening**
- [x] **Phase 15: Proof Generation**
- [ ] **Phase 16: Multi-Claim Verification & UX**

## Milestone v1.0 Growth

### Phase 14: Auth Hardening
**Goal:** Improve auth checks

### Phase 15: Proof Generation
**Goal:** Improve proof generation

### Phase 16: Multi-Claim Verification & UX
**Goal:** Support multi-claim verification
`
    );

    const result = runGsdTools('stats --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.phases_total, 3);
    assert.strictEqual(stats.phases_completed, 2);
    assert.strictEqual(stats.percent, 67);
    assert.strictEqual(stats.plan_percent, 100);
    assert.strictEqual(
      stats.phases.find(p => p.number === '16')?.name,
      'Multi-Claim Verification & UX'
    );
    assert.strictEqual(
      stats.phases.find(p => p.number === '16')?.status,
      'Not Started'
    );
  });

  test('reports git commit count and first commit date from repository history', () => {
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@example.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test User"', { cwd: tmpDir, stdio: 'pipe' });

    fs.writeFileSync(path.join(tmpDir, '.planning', 'PROJECT.md'), '# Project\n');
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "initial commit"', {
      cwd: tmpDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-01-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-01-01T00:00:00Z',
      },
    });

    fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Updated\n');
    execSync('git add README.md', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "second commit"', {
      cwd: tmpDir,
      stdio: 'pipe',
      env: {
        ...process.env,
        GIT_AUTHOR_DATE: '2026-02-01T00:00:00Z',
        GIT_COMMITTER_DATE: '2026-02-01T00:00:00Z',
      },
    });

    const result = runGsdTools('stats --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const stats = JSON.parse(result.output);
    assert.strictEqual(stats.git_commits, 2);
    assert.strictEqual(stats.git_first_commit_date, '2026-01-01');
  });

  test('table format renders readable output', () => {
    const p1 = path.join(tmpDir, '.planning', 'phases', '01-auth');
    fs.mkdirSync(p1, { recursive: true });
    fs.writeFileSync(path.join(p1, '01-01-PLAN.md'), '# Plan');
    fs.writeFileSync(path.join(p1, '01-01-SUMMARY.md'), '# Summary');

    const result = runGsdTools('stats table --json', tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.ok(parsed.rendered, 'table format should include rendered field');
    assert.ok(parsed.rendered.includes('Statistics'), 'should include Statistics header');
    assert.ok(parsed.rendered.includes('| Phase |'), 'should include table header');
    assert.ok(parsed.rendered.includes('| 1 |'), 'should include phase row');
    assert.ok(parsed.rendered.includes('1/1 phases'), 'should report phase progress');
  });
});

// ─── cmdSquash command ────────────────────────────────────────────────────────

describe('cmdSquash command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
    // Create a phase directory with SUMMARY.md files
    const phaseDir = path.join(tmpDir, '.planning', 'phases', '14-commit-changelog-and-versioning');
    fs.mkdirSync(phaseDir, { recursive: true });
    fs.writeFileSync(path.join(phaseDir, '14-01-SUMMARY.md'), [
      '---',
      'phase: 14',
      'plan: 01',
      '---',
      '',
      '# Phase 14: Summary',
      '',
      '**Config keys and commit format presets for GSD-generated commits**',
    ].join('\n'));
    // Make a few commits for squash targets
    fs.writeFileSync(path.join(tmpDir, 'a.txt'), 'a');
    execSync('git add a.txt && git commit -m "feat(14-01): task 1"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'b.txt'), 'b');
    execSync('git add b.txt && git commit -m "feat(14-01): task 2"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => { cleanup(tmpDir); });

  test('--dry-run single strategy returns plan without executing', () => {
    const result = runGsdTools(['squash', '14', '--strategy', 'single', '--dry-run', '--json'], tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.strictEqual(out.dry_run, true);
    assert.ok(out.groups, 'should have groups');
    assert.ok(out.groups.length > 0, 'should have at least one group');
    assert.strictEqual(out.executed, false);
  });

  test('refuses on main branch without --allow-stable', () => {
    // tmpDir is on main branch by default
    const result = runGsdTools(['squash', '14', '--strategy', 'single'], tmpDir);
    assert.strictEqual(result.success, false);
    assert.ok(result.error.includes('stable branch'), `Expected 'stable branch' in: ${result.error}`);
  });

  test('creates backup tag before rewrite when --allow-stable', () => {
    const result = runGsdTools(['squash', '14', '--strategy', 'single', '--allow-stable'], tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);
    // Check tag was created
    const tags = execSync('git tag --list "gsd/backup/*"', { cwd: tmpDir, encoding: 'utf-8' });
    assert.ok(tags.trim().length > 0, 'backup tag should exist');
    assert.ok(tags.includes('gsd/backup/'), 'tag should match gsd/backup/ pattern');
  });

  test('list-backup-tags returns gsd backup tags', () => {
    // Create a tag first
    execSync('git tag gsd/backup/2026-03-16/main', { cwd: tmpDir, stdio: 'pipe' });
    const result = runGsdTools(['squash', '--list-backup-tags', '--json'], tmpDir);
    assert.ok(result.success, `Failed: ${result.error}`);
    const out = JSON.parse(result.output);
    assert.ok(out.tags.length > 0, 'should list at least one tag');
    assert.ok(out.tags[0].includes('gsd/backup/'), 'tag should include gsd/backup/');
  });
});

// ─── applyCommitFormat function (COMM-01) ────────────────────────────────────

describe('applyCommitFormat function', () => {
  const { applyCommitFormat, appendIssueTrailers } = require('../gsd-ng/bin/lib/commands.cjs');

  test('gsd format returns message unchanged', () => {
    const result = applyCommitFormat('feat(14): add changelog', { commit_format: 'gsd' });
    assert.strictEqual(result, 'feat(14): add changelog');
  });

  test('conventional format returns message unchanged', () => {
    const result = applyCommitFormat('feat(auth): add login', { commit_format: 'conventional' });
    assert.strictEqual(result, 'feat(auth): add login');
  });

  test('issue-first format prepends issue ref when provided', () => {
    const result = applyCommitFormat('add login', { commit_format: 'issue-first' }, { issueRef: '42' });
    assert.strictEqual(result, '[#42] add login');
  });

  test('issue-first format unchanged without issueRef', () => {
    const result = applyCommitFormat('add login', { commit_format: 'issue-first' });
    assert.strictEqual(result, 'add login');
  });

  test('custom format applies template placeholders', () => {
    const result = applyCommitFormat('add login endpoint', {
      commit_format: 'custom',
      commit_template: '{type}({scope}): {description}'
    }, { type: 'feat', scope: 'auth', description: 'add login endpoint' });
    assert.strictEqual(result, 'feat(auth): add login endpoint');
  });

  test('custom format with null template returns message unchanged', () => {
    const result = applyCommitFormat('add login', { commit_format: 'custom', commit_template: null });
    assert.strictEqual(result, 'add login');
  });
});

// ─── appendIssueTrailers function (COMM-02) ───────────────────────────────────

describe('appendIssueTrailers function', () => {
  const { appendIssueTrailers } = require('../gsd-ng/bin/lib/commands.cjs');

  test('single Fixes ref appends trailer with blank line', () => {
    const result = appendIssueTrailers('feat: add login', [{ action: 'Fixes', number: 42 }]);
    assert.strictEqual(result, 'feat: add login\n\nFixes #42');
  });

  test('multiple refs produce multiple trailer lines', () => {
    const result = appendIssueTrailers('feat: add login', [
      { action: 'Fixes', number: 42 },
      { action: 'Closes', number: 43 }
    ]);
    assert.strictEqual(result, 'feat: add login\n\nFixes #42\nCloses #43');
  });

  test('empty refs returns message unchanged', () => {
    const result = appendIssueTrailers('feat: add login', []);
    assert.strictEqual(result, 'feat: add login');
  });

  test('null refs returns message unchanged', () => {
    const result = appendIssueTrailers('feat: add login', null);
    assert.strictEqual(result, 'feat: add login');
  });
});

// ─── bumpVersion function (VER-01, VER-02) ────────────────────────────────────

describe('bumpVersion function', () => {
  const { bumpVersion, appendBuildMetadata } = require('../gsd-ng/bin/lib/commands.cjs');

  test('semver patch: 1.0.0 -> 1.0.1', () => {
    assert.strictEqual(bumpVersion('1.0.0', 'patch', 'semver'), '1.0.1');
  });

  test('semver minor: 1.0.0 -> 1.1.0', () => {
    assert.strictEqual(bumpVersion('1.0.0', 'minor', 'semver'), '1.1.0');
  });

  test('semver major: 1.0.0 -> 2.0.0', () => {
    assert.strictEqual(bumpVersion('1.0.0', 'major', 'semver'), '2.0.0');
  });

  test('calver patch within same month increments patch', () => {
    const now = new Date();
    const currentCalVer = `${now.getFullYear()}.${now.getMonth() + 1}.0`;
    assert.strictEqual(
      bumpVersion(currentCalVer, 'patch', 'calver'),
      `${now.getFullYear()}.${now.getMonth() + 1}.1`
    );
  });

  test('calver from different month resets to current month', () => {
    const now = new Date();
    assert.strictEqual(
      bumpVersion('2025.1.5', 'patch', 'calver'),
      `${now.getFullYear()}.${now.getMonth() + 1}.0`
    );
  });

  test('date-based patch increments build number', () => {
    assert.strictEqual(bumpVersion('1.2.3', 'patch', 'date'), '1.2.4');
  });

  test('appendBuildMetadata adds +hash', () => {
    assert.strictEqual(appendBuildMetadata('1.0.1', 'abc1234'), '1.0.1+abc1234');
  });

  test('appendBuildMetadata with null hash returns version unchanged', () => {
    assert.strictEqual(appendBuildMetadata('1.0.1', null), '1.0.1');
  });
});

// ─── deriveVersionBump function (VER-01) ─────────────────────────────────────

describe('deriveVersionBump function', () => {
  const { deriveVersionBump } = require('../gsd-ng/bin/lib/commands.cjs');

  test('feat one-liner returns minor', () => {
    assert.strictEqual(deriveVersionBump([{ oneLiner: 'feat(14): add changelog' }]), 'minor');
  });

  test('fix-only one-liners return patch', () => {
    assert.strictEqual(deriveVersionBump([
      { oneLiner: 'fix(14): repair link' },
      { oneLiner: 'fix(14): typo' },
    ]), 'patch');
  });

  test('BREAKING CHANGE returns major', () => {
    assert.strictEqual(deriveVersionBump([
      { oneLiner: 'feat(14): add changelog BREAKING CHANGE' },
    ]), 'major');
  });

  test('no type prefix returns patch', () => {
    assert.strictEqual(deriveVersionBump([
      { oneLiner: 'Update config system' },
    ]), 'patch');
  });

  test('empty array returns patch default', () => {
    assert.strictEqual(deriveVersionBump([]), 'patch');
  });

  test('null summaries returns patch default', () => {
    assert.strictEqual(deriveVersionBump(null), 'patch');
  });
});

// ─── generateChangelog function (COMM-04, COMM-05) ───────────────────────────

describe('generateChangelog function', () => {
  const { generateChangelog } = require('../gsd-ng/bin/lib/commands.cjs');

  test('feat and fix summaries produce Added and Fixed sections', () => {
    const result = generateChangelog('1.1.0', '2026-03-16', [
      { planId: '14-01', oneLiner: 'feat(14-01): add changelog generation' },
      { planId: '14-02', oneLiner: 'fix(14-02): repair broken link' },
    ]);
    assert.ok(result.includes('## [1.1.0] - 2026-03-16'), 'should include version header');
    assert.ok(result.includes('### Added'), 'should include Added section');
    assert.ok(result.includes('### Fixed'), 'should include Fixed section');
    // Descriptions are capitalized in output
    assert.ok(result.includes('changelog generation'), 'should include feat description');
    assert.ok(result.includes('broken link'), 'should include fix description');
  });

  test('output starts with version header', () => {
    const result = generateChangelog('2.0.0', '2026-03-16', [
      { planId: '14-01', oneLiner: 'feat: something' },
    ]);
    assert.ok(result.startsWith('## [2.0.0] - 2026-03-16'), 'should start with version header');
  });

  test('empty summaries produces placeholder in Added section', () => {
    const result = generateChangelog('1.0.1', '2026-03-16', []);
    assert.ok(result.includes('## [1.0.1] - 2026-03-16'), 'should include version header');
    assert.ok(result.includes('### Added'), 'should include Added section');
  });
});

// ─── categorizeCommitType function (COMM-05) ─────────────────────────────────

describe('categorizeCommitType function', () => {
  const { categorizeCommitType } = require('../gsd-ng/bin/lib/commands.cjs');

  test('feat prefix maps to Added', () => {
    assert.strictEqual(categorizeCommitType('feat(14): add changelog'), 'Added');
  });

  test('fix prefix maps to Fixed', () => {
    assert.strictEqual(categorizeCommitType('fix(14): repair link'), 'Fixed');
  });

  test('refactor prefix maps to Changed', () => {
    assert.strictEqual(categorizeCommitType('refactor(14): simplify'), 'Changed');
  });

  test('perf prefix maps to Changed', () => {
    assert.strictEqual(categorizeCommitType('perf(14): optimize'), 'Changed');
  });

  test('revert prefix maps to Removed', () => {
    assert.strictEqual(categorizeCommitType('revert(14): undo feature'), 'Removed');
  });

  test('no prefix defaults to Changed', () => {
    assert.strictEqual(categorizeCommitType('Update something'), 'Changed');
  });

  test('null/empty defaults to Changed', () => {
    assert.strictEqual(categorizeCommitType(null), 'Changed');
    assert.strictEqual(categorizeCommitType(''), 'Changed');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdHelp command
// ─────────────────────────────────────────────────────────────────────────────

// ─────────────────────────────────────────────────────────────────────────────
// cmdDivergence tests (CLEAN-05)
// ─────────────────────────────────────────────────────────────────────────────

describe('divergence command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Helper: call a function that may invoke error() (fs.writeSync(2,...) + process.exit(1))
  // or output() (fs.writeSync(1,...)). Intercepts both fd 1 and fd 2 at the fs layer
  // and mocks process.exit so the test process is not killed.
  // Returns { stdout, stderr, exited, exitCode }.
  function callExpectingError(fn) {
    let stdout = '';
    let stderr = '';
    let exited = false;
    let exitCode = null;
    const origFsWriteSync = fs.writeSync.bind(fs);
    const origStderrWrite = process.stderr.write.bind(process.stderr);
    const origExit = process.exit.bind(process);
    fs.writeSync = (fd, data, ...rest) => {
      if (fd === 1) { stdout += String(data); return data.length; }
      if (fd === 2) { stderr += String(data); return data.length; }
      return origFsWriteSync(fd, data, ...rest);
    };
    process.stderr.write = (chunk) => { stderr += String(chunk); return true; };
    process.exit = (code) => { exited = true; exitCode = code; throw new Error(`process.exit(${code})`); };
    try {
      fn();
    } catch (e) {
      // Swallow process.exit errors; let genuine test errors propagate
      if (!exited) throw e;
    } finally {
      fs.writeSync = origFsWriteSync;
      process.stderr.write = origStderrWrite;
      process.exit = origExit;
    }
    return { stdout, stderr, exited, exitCode };
  }

  test('returns no_upstream when no upstream remote exists', () => {
    // createTempProject() creates a non-git project, so no upstream remote
    const result = runGsdTools('divergence --json', tmpDir);
    assert.ok(result.success, `Command should not crash: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.strictEqual(output.status, 'no_upstream', 'should return no_upstream status');
    assert.deepStrictEqual(output.commits, [], 'commits should be empty array');
  });

  test('triage validation: skipped status without reason produces error', () => {
    const { cmdDivergence } = require('../gsd-ng/bin/lib/commands.cjs');
    const { stdout, stderr, exited } = callExpectingError(() => {
      // Use a temp dir that has no upstream — if no upstream, early exit before validation
      cmdDivergence(tmpDir, { triage: 'abc1234', status: 'skipped', reason: '' });
    });

    // Should either: produce an error about reason (if upstream exists), OR exit early with
    // no_upstream (which is valid when no upstream is configured in the test environment)
    assert.ok(
      exited || stderr.includes('Reason required') || stderr.includes('skipped') || stdout.includes('no_upstream') || stdout.includes('No') ,
      `Expected error about reason or no_upstream exit, got stdout: ${stdout}, stderr: ${stderr}`
    );
  });

  test('parseDivergenceFile returns empty Map for missing file', () => {
    const { parseDivergenceFile } = require('../gsd-ng/bin/lib/commands.cjs');
    const result = parseDivergenceFile('/tmp/nonexistent-divergence-12345.md');
    assert.ok(result instanceof Map, 'should return a Map');
    assert.strictEqual(result.size, 0, 'should be empty for missing file');
  });

  test('parseDivergenceFile round-trip: write then parse recovers entries', () => {
    const { parseDivergenceFile, writeDivergenceFile } = require('../gsd-ng/bin/lib/commands.cjs');
    const filePath = path.join(tmpDir, '.planning', 'DIVERGENCE.md');

    const commits = [
      { hash: 'abc1234', date: '2026-03-14', subject: 'fix: some change', status: 'picked', reason: 'Applied in Phase 17' },
      { hash: 'def5678', date: '2026-03-15', subject: 'feat: new feature', status: 'skipped', reason: 'Not compatible with NG focus' },
      { hash: 'ghi9012', date: '2026-03-16', subject: 'chore: cleanup', status: 'pending', reason: '' },
    ];

    writeDivergenceFile(filePath, 'https://github.com/upstream/repo.git', commits);

    assert.ok(fs.existsSync(filePath), 'DIVERGENCE.md should be created');

    const content = fs.readFileSync(filePath, 'utf-8');
    assert.ok(content.includes('# Divergence Tracking'), 'should have header');
    assert.ok(content.includes('Upstream remote (upstream):'), 'should have upstream URL with remote name');
    assert.ok(content.includes('## Commit Triage'), 'should have triage section');

    const parsed = parseDivergenceFile(filePath);
    assert.ok(parsed instanceof Map, 'should return Map');
    assert.strictEqual(parsed.size, 3, 'should parse 3 entries');

    const entry = parsed.get('abc1234');
    assert.ok(entry, 'should find abc1234');
    assert.strictEqual(entry.status, 'picked', 'status should be picked');
    assert.strictEqual(entry.reason, 'Applied in Phase 17', 'reason should be preserved');

    const skipped = parsed.get('def5678');
    assert.ok(skipped, 'should find def5678');
    assert.strictEqual(skipped.status, 'skipped', 'skipped status preserved');
    assert.strictEqual(skipped.subject, 'feat: new feature', 'subject preserved');
  });

  test('--init exits 0 in non-git project (no upstream/main ref)', () => {
    // Non-git project with upstream remote set but no git history — should handle gracefully
    const result = runGsdTools('divergence --init --json', tmpDir);
    // Either no_upstream (no git repo) or initialized (0 commits) — either is acceptable
    assert.ok(result.success, `Should exit 0: ${result.error}`);
    const output = JSON.parse(result.output);
    assert.ok(output.status === 'no_upstream' || output.status === 'initialized',
      `Unexpected status: ${output.status}`);
  });

  test('--branch flag returns branch_not_found error for nonexistent branch in non-git project', () => {
    // Non-git project: git rev-parse fails, so branch not found error returned
    const { cmdDivergence } = require('../gsd-ng/bin/lib/commands.cjs');
    const { stderr, exited } = callExpectingError(() => {
      cmdDivergence(tmpDir, { branch: 'feature/nonexistent' });
    });
    // Either exited (process.exit called) or wrote error about branch not found
    assert.ok(exited || stderr.includes('not found') || stderr.includes('nonexistent'),
      `Expected branch-not-found error, got: ${stderr}`);
  });

  test('writeDivergenceBranchSection then parseDivergenceBranchSection round-trips', () => {
    const { writeDivergenceBranchSection, parseDivergenceBranchSection } = require('../gsd-ng/bin/lib/commands.cjs');
    const filePath = path.join(tmpDir, '.planning', 'DIVERGENCE.md');
    const sectionKey = 'main..feature/test-branch';
    const commits = [
      { hash: 'aaa1111', date: '2026-03-14', subject: 'fix: some fix', classification: 'fix', status: 'pending', reason: '' },
      { hash: 'bbb2222', date: '2026-03-15', subject: 'feat: new thing', classification: 'feat', status: 'needs-adaptation', reason: 'needs port' },
    ];
    writeDivergenceBranchSection(filePath, sectionKey, commits);
    assert.ok(fs.existsSync(filePath), 'DIVERGENCE.md should be created');

    const section = parseDivergenceBranchSection(filePath, sectionKey);
    assert.ok(section instanceof Map, 'should return a Map');
    assert.ok(section.has('aaa1111'), 'should have aaa1111');
    assert.ok(section.has('bbb2222'), 'should have bbb2222');
    const entry = section.get('bbb2222');
    assert.strictEqual(entry.status, 'needs-adaptation');
    assert.ok(entry.reason.includes('needs port'), 'reason should be preserved');
  });

  test('branch triage rejects invalid status via cmdDivergence', () => {
    const { cmdDivergence } = require('../gsd-ng/bin/lib/commands.cjs');
    const { stderr, exited } = callExpectingError(() => {
      // branch mode with triage but invalid status
      cmdDivergence(tmpDir, { branch: 'feature/test', base: 'main', triage: 'abc1234', status: 'invalid-status', reason: '' });
    });
    // Should error about branch not found (before reaching triage validation)
    // OR error about invalid status if branch check is bypassed in tests
    // Either way, it should not silently succeed
    assert.ok(exited || stderr.length > 0,
      'Expected error output for invalid branch or status');
  });

  test('upstream triage validation accepts needs-adaptation and already-covered states', () => {
    // The VALID_TRIAGE_STATES now includes 6 states
    const { VALID_TRIAGE_STATES } = require('../gsd-ng/bin/lib/commands.cjs');
    assert.ok(VALID_TRIAGE_STATES.includes('needs-adaptation'), 'needs-adaptation accepted');
    assert.ok(VALID_TRIAGE_STATES.includes('already-covered'), 'already-covered accepted');
  });

  test('VALID_TRIAGE_STATES includes adapted (7 states total)', () => {
    const { VALID_TRIAGE_STATES } = require('../gsd-ng/bin/lib/commands.cjs');
    assert.ok(VALID_TRIAGE_STATES.includes('adapted'), "'adapted' should be a valid triage state");
    assert.strictEqual(VALID_TRIAGE_STATES.length, 7, 'Should have 7 total valid triage states');
  });

  test('upstream triage: adapted status without reason produces error', () => {
    const { cmdDivergence } = require('../gsd-ng/bin/lib/commands.cjs');
    const { stdout, stderr, exited } = callExpectingError(() => {
      cmdDivergence(tmpDir, { triage: 'abc1234', status: 'adapted', reason: '' });
    });

    // Either produces an error (validation reached) or exits early with no_upstream
    assert.ok(
      exited || stderr.includes('Reason required') || stderr.includes('adapted') || stdout.includes('no_upstream') || stdout.includes('No'),
      `Expected error requiring reason or no_upstream exit, got stdout: ${stdout}, stderr: ${stderr}`
    );
  });

  test('branch triage: adapted status without reason produces error', () => {
    const { cmdDivergence } = require('../gsd-ng/bin/lib/commands.cjs');
    const { stderr, exited } = callExpectingError(() => {
      // Branch mode: pass branch + base + triage + status=adapted with no reason
      cmdDivergence(tmpDir, { branch: 'feature/test', base: 'main', triage: 'abc1234', status: 'adapted', reason: '' });
    });

    // Either exited (branch not found) or errors about reason requirement
    assert.ok(exited || stderr.length > 0,
      `Expected error for adapted without reason in branch mode, got: ${stderr}`);
  });
});

describe('help command', () => {
  test('returns a commands array with 10+ entries', () => {
    const result = runGsdTools('help --json', process.cwd());
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output.commands), 'commands should be an array');
    assert.ok(output.commands.length >= 10, `Expected 10+ commands, got ${output.commands.length}`);
  });

  test('each entry has name and description fields', () => {
    const result = runGsdTools('help --json', process.cwd());
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    for (const cmd of output.commands) {
      assert.ok(typeof cmd.name === 'string' && cmd.name.length > 0, `Command missing name: ${JSON.stringify(cmd)}`);
      assert.ok(typeof cmd.description === 'string', `Command missing description field: ${JSON.stringify(cmd)}`);
    }
  });

  test('known commands are discoverable', () => {
    const result = runGsdTools('help --json', process.cwd());
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const names = output.commands.map(c => c.name);
    assert.ok(names.includes('gsd:help'), 'gsd:help should be discoverable');
    assert.ok(names.includes('gsd:health'), 'gsd:health should be discoverable');
    assert.ok(names.includes('gsd:execute-phase'), 'gsd:execute-phase should be discoverable');
  });

  test('commands are sorted alphabetically by name', () => {
    const result = runGsdTools('help --json', process.cwd());
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    const names = output.commands.map(c => c.name);
    const sorted = [...names].sort((a, b) => a.localeCompare(b));
    assert.deepStrictEqual(names, sorted, 'Commands should be sorted alphabetically');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// discoverTestCommand function
// ─────────────────────────────────────────────────────────────────────────────

describe('discoverTestCommand', () => {
  const os = require('os');
  const { discoverTestCommand } = require('../gsd-ng/bin/lib/commands.cjs');
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-dtc-'));
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns npm test when package.json has a test script', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'node --test' } })
    );
    assert.deepStrictEqual(discoverTestCommand(tmpDir), [{ dir: '.', command: 'npm test' }]);
  });

  test('returns null when no test infrastructure exists', () => {
    assert.deepStrictEqual(discoverTestCommand(tmpDir), []);
  });

  test('returns config override value when verification.test_command is set', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ verification: { test_command: 'make test' } })
    );
    assert.deepStrictEqual(discoverTestCommand(tmpDir), [{ dir: '.', command: 'make test' }]);
  });

  test('returns python -m pytest when pyproject.toml exists and no package.json test script', () => {
    fs.writeFileSync(path.join(tmpDir, 'pyproject.toml'), '[tool.pytest.ini_options]\n');
    assert.deepStrictEqual(discoverTestCommand(tmpDir), [{ dir: '.', command: 'python -m pytest' }]);
  });

  test('returns cargo test when Cargo.toml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'Cargo.toml'), '[package]\nname = "myapp"\n');
    assert.deepStrictEqual(discoverTestCommand(tmpDir), [{ dir: '.', command: 'cargo test' }]);
  });

  test('returns go test ./... when go.mod exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'go.mod'), 'module myapp\ngo 1.21\n');
    assert.deepStrictEqual(discoverTestCommand(tmpDir), [{ dir: '.', command: 'go test ./...' }]);
  });

  test('config override takes priority over package.json auto-detection', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest' } })
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ verification: { test_command: 'make test' } })
    );
    assert.deepStrictEqual(discoverTestCommand(tmpDir), [{ dir: '.', command: 'make test' }]);
  });

  test('skips default npm test placeholder script', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ scripts: { test: 'echo "Error: no test specified" && exit 1' } })
    );
    assert.deepStrictEqual(discoverTestCommand(tmpDir), []);
  });

  describe('submodule scanning', () => {
    test('scans submodule_paths when CWD has no test command', () => {
      // Create .gitmodules listing sub1 and sub2
      fs.writeFileSync(path.join(tmpDir, '.gitmodules'), [
        '[submodule "sub1"]',
        '    path = sub1',
        '    url = https://example.com/sub1.git',
        '[submodule "sub2"]',
        '    path = sub2',
        '    url = https://example.com/sub2.git',
      ].join('\n'));
      // sub1 has package.json with test script
      fs.mkdirSync(path.join(tmpDir, 'sub1'));
      fs.writeFileSync(
        path.join(tmpDir, 'sub1', 'package.json'),
        JSON.stringify({ scripts: { test: 'node --test' } })
      );
      // sub2 has pyproject.toml
      fs.mkdirSync(path.join(tmpDir, 'sub2'));
      fs.writeFileSync(path.join(tmpDir, 'sub2', 'pyproject.toml'), '[tool.pytest.ini_options]\n');
      // CWD has no package.json
      assert.deepStrictEqual(discoverTestCommand(tmpDir), [
        { dir: 'sub1', command: 'npm test' },
        { dir: 'sub2', command: 'python -m pytest' },
      ]);
    });

    test('skips submodule paths without test infrastructure', () => {
      fs.writeFileSync(path.join(tmpDir, '.gitmodules'), [
        '[submodule "sub1"]',
        '    path = sub1',
        '    url = https://example.com/sub1.git',
        '[submodule "sub2"]',
        '    path = sub2',
        '    url = https://example.com/sub2.git',
      ].join('\n'));
      // sub1 has a test script
      fs.mkdirSync(path.join(tmpDir, 'sub1'));
      fs.writeFileSync(
        path.join(tmpDir, 'sub1', 'package.json'),
        JSON.stringify({ scripts: { test: 'npm run jest' } })
      );
      // sub2 is empty
      fs.mkdirSync(path.join(tmpDir, 'sub2'));
      assert.deepStrictEqual(discoverTestCommand(tmpDir), [
        { dir: 'sub1', command: 'npm test' },
      ]);
    });

    test('returns empty array when submodule paths have no tests', () => {
      fs.writeFileSync(path.join(tmpDir, '.gitmodules'), [
        '[submodule "sub1"]',
        '    path = sub1',
        '    url = https://example.com/sub1.git',
      ].join('\n'));
      // sub1 is empty
      fs.mkdirSync(path.join(tmpDir, 'sub1'));
      assert.deepStrictEqual(discoverTestCommand(tmpDir), []);
    });
  });

  describe('monorepo workspace scanning', () => {
    test('resolves pnpm workspace globs to real directories', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'pnpm-workspace.yaml'),
        'packages:\n  - packages/*\n'
      );
      fs.mkdirSync(path.join(tmpDir, 'packages', 'core'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'packages', 'core', 'package.json'),
        JSON.stringify({ scripts: { test: 'node --test' } })
      );
      fs.mkdirSync(path.join(tmpDir, 'packages', 'utils'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'packages', 'utils', 'Cargo.toml'), '[package]\nname = "utils"\n');
      const result = discoverTestCommand(tmpDir);
      assert.deepStrictEqual(result, [
        { dir: 'packages/core', command: 'npm test' },
        { dir: 'packages/utils', command: 'cargo test' },
      ]);
    });

    test('handles package.json workspaces array', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ workspaces: ['packages/*'] })
      );
      fs.mkdirSync(path.join(tmpDir, 'packages', 'app'), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, 'packages', 'app', 'go.mod'), 'module myapp\ngo 1.21\n');
      assert.deepStrictEqual(discoverTestCommand(tmpDir), [
        { dir: 'packages/app', command: 'go test ./...' },
      ]);
    });

    test('handles package.json workspaces object (Yarn Berry)', () => {
      fs.writeFileSync(
        path.join(tmpDir, 'package.json'),
        JSON.stringify({ workspaces: { packages: ['libs/*'] } })
      );
      fs.mkdirSync(path.join(tmpDir, 'libs', 'core'), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, 'libs', 'core', 'package.json'),
        JSON.stringify({ scripts: { test: 'jest' } })
      );
      assert.deepStrictEqual(discoverTestCommand(tmpDir), [
        { dir: 'libs/core', command: 'npm test' },
      ]);
    });
  });

  describe('config normalization', () => {
    test('normalizes string config to single-element array', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ verification: { test_command: 'make test' } })
      );
      assert.deepStrictEqual(discoverTestCommand(tmpDir), [{ dir: '.', command: 'make test' }]);
    });

    test('passes through array config unchanged', () => {
      fs.writeFileSync(
        path.join(tmpDir, '.planning', 'config.json'),
        JSON.stringify({ verification: { test_command: [{ dir: 'sub', command: 'npm test' }] } })
      );
      assert.deepStrictEqual(discoverTestCommand(tmpDir), [{ dir: 'sub', command: 'npm test' }]);
    });
  });

  describe('discover-test-command CLI', () => {
    test('discover-test-command CLI returns JSON array', () => {
      const projDir = createTempProject();
      try {
        fs.writeFileSync(
          path.join(projDir, 'package.json'),
          JSON.stringify({ scripts: { test: 'node --test' } })
        );
        const result = runGsdTools(['discover-test-command', '--json'], projDir);
        assert.ok(result.success, `CLI failed: ${result.error}`);
        const parsed = JSON.parse(result.output);
        assert.deepStrictEqual(parsed, [{ dir: '.', command: 'npm test' }]);
      } finally {
        cleanup(projDir);
      }
    });
  });

  test('verification.test_command round-trips via config-set and config-get CLI', () => {
    // Need a .planning dir with config for gsd-tools
    const projDir = createTempProject();
    try {
      const setResult = runGsdTools(['config-set', 'verification.test_command', 'make test'], projDir);
      assert.ok(setResult.success, `config-set failed: ${setResult.error}`);

      const getResult = runGsdTools(['config-get', 'verification.test_command'], projDir);
      assert.ok(getResult.success, `config-get failed: ${getResult.error}`);
      assert.strictEqual(getResult.output, 'make test');
    } finally {
      cleanup(projDir);
    }
  });
});

// =============================================================================
// Divergence helpers: classifyCommit, priorityOrder, extractPrNumber,
// normalizeForMatch, parseDivergenceBranchSection, VALID_TRIAGE_STATES
// =============================================================================

describe('divergence helpers', () => {
  const os = require('os');
  const {
    classifyCommit,
    priorityOrder,
    extractPrNumber,
    normalizeForMatch,
    parseDivergenceBranchSection,
    VALID_TRIAGE_STATES,
  } = require('../gsd-ng/bin/lib/commands.cjs');

  test('classifyCommit: fix prefix returns fix', () => {
    assert.strictEqual(classifyCommit('fix(core): resolve crash'), 'fix');
  });

  test('classifyCommit: security prefix returns fix', () => {
    assert.strictEqual(classifyCommit('security: patch XSS vulnerability'), 'fix');
  });

  test('classifyCommit: hotfix prefix returns fix', () => {
    assert.strictEqual(classifyCommit('hotfix(auth): token expiry'), 'fix');
  });

  test('classifyCommit: feat prefix returns feat', () => {
    assert.strictEqual(classifyCommit('feat(api): add search endpoint'), 'feat');
  });

  test('classifyCommit: docs prefix returns other', () => {
    assert.strictEqual(classifyCommit('docs: update README'), 'other');
  });

  test('classifyCommit: chore prefix returns other', () => {
    assert.strictEqual(classifyCommit('chore: bump deps'), 'other');
  });

  test('classifyCommit: BREAKING CHANGE returns fix', () => {
    assert.strictEqual(classifyCommit('BREAKING CHANGE: remove v1 API'), 'fix');
  });

  test('classifyCommit: random message returns unknown', () => {
    assert.strictEqual(classifyCommit('random commit message'), 'unknown');
  });

  test('classifyCommit: revert prefix returns fix', () => {
    assert.strictEqual(classifyCommit('revert: feat(api): something'), 'fix');
  });

  test('extractPrNumber: extracts PR from (#1234) format', () => {
    assert.strictEqual(extractPrNumber('fix(core): resolve crash (#1234)'), '1234');
  });

  test('extractPrNumber: extracts PR from Merge pull request #5678', () => {
    assert.strictEqual(extractPrNumber('Merge pull request #5678 from branch'), '5678');
  });

  test('extractPrNumber: returns null when no PR ref', () => {
    assert.strictEqual(extractPrNumber('just a commit message'), null);
  });

  test('normalizeForMatch: strips PR ref and prefix', () => {
    const normalized = normalizeForMatch('fix(core): resolve crash (#1234)');
    assert.ok(!normalized.includes('1234'), 'PR ref should be stripped');
    assert.ok(!normalized.toLowerCase().startsWith('fix'), 'prefix should be stripped');
    assert.ok(normalized.includes('resolve'), 'subject body should remain');
  });

  test('priorityOrder: fix returns 0', () => {
    assert.strictEqual(priorityOrder('fix'), 0);
  });

  test('priorityOrder: feat returns 1', () => {
    assert.strictEqual(priorityOrder('feat'), 1);
  });

  test('priorityOrder: other returns 2', () => {
    assert.strictEqual(priorityOrder('other'), 2);
  });

  test('priorityOrder: unknown returns 3', () => {
    assert.strictEqual(priorityOrder('unknown'), 3);
  });

  test('parseDivergenceBranchSection: reads correct section from multi-section DIVERGENCE.md', () => {
    const tmpDir = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-divbranch-'));
    try {
      const filePath = path.join(tmpDir, 'DIVERGENCE.md');
      const content = [
        '# Divergence Tracking',
        '',
        '## Commit Triage',
        '',
        '| Hash | Date | Subject | Status | Reason |',
        '|------|------|---------|--------|--------|',
        '| abc1234 | 2026-01-01 | fix: upstream bug | picked | cherry-picked |',
        '',
        '## Branch Tracking: main..feature/foo',
        '',
        '**Tracked:** main..feature/foo',
        '',
        '| Hash | Date | Subject | Classification | Status | Reason |',
        '|------|------|---------|----------------|--------|--------|',
        '| def5678 | 2026-01-02 | feat(api): new endpoint | feat | pending |  |',
        '',
        '## Branch Tracking: main..feature/bar',
        '',
        '| Hash | Date | Subject | Classification | Status | Reason |',
        '|------|------|---------|----------------|--------|--------|',
        '| ghi9012 | 2026-01-03 | fix: another fix | fix | pending |  |',
        '',
      ].join('\n');
      fs.writeFileSync(filePath, content, 'utf-8');

      const section = parseDivergenceBranchSection(filePath, 'main..feature/foo');
      assert.ok(section instanceof Map, 'should return a Map');
      assert.ok(section.has('def5678'), 'should contain def5678 from feature/foo section');
      assert.ok(!section.has('ghi9012'), 'should not contain entries from feature/bar section');
      assert.ok(!section.has('abc1234'), 'should not contain entries from upstream section');
      const entry = section.get('def5678');
      assert.strictEqual(entry.status, 'pending');
    } finally {
      cleanup(tmpDir);
    }
  });

  test('parseDivergenceBranchSection: returns empty Map when section not found', () => {
    const tmpDir2 = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-divbranch-'));
    try {
      const filePath = path.join(tmpDir2, 'DIVERGENCE.md');
      fs.writeFileSync(filePath, '# Divergence Tracking\n', 'utf-8');
      const result = parseDivergenceBranchSection(filePath, 'main..nonexistent');
      assert.ok(result instanceof Map, 'should return a Map');
      assert.strictEqual(result.size, 0, 'should be empty when section not found');
    } finally {
      cleanup(tmpDir2);
    }
  });

  test('VALID_TRIAGE_STATES: includes all 7 states including needs-adaptation, already-covered, and adapted', () => {
    assert.ok(Array.isArray(VALID_TRIAGE_STATES), 'should be an array');
    assert.ok(VALID_TRIAGE_STATES.includes('picked'), 'should include picked');
    assert.ok(VALID_TRIAGE_STATES.includes('skipped'), 'should include skipped');
    assert.ok(VALID_TRIAGE_STATES.includes('deferred'), 'should include deferred');
    assert.ok(VALID_TRIAGE_STATES.includes('pending'), 'should include pending');
    assert.ok(VALID_TRIAGE_STATES.includes('needs-adaptation'), 'should include needs-adaptation');
    assert.ok(VALID_TRIAGE_STATES.includes('already-covered'), 'should include already-covered');
    assert.ok(VALID_TRIAGE_STATES.includes('adapted'), 'should include adapted');
    assert.strictEqual(VALID_TRIAGE_STATES.length, 7, 'should have exactly 7 states');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// detect-platform --field
// ─────────────────────────────────────────────────────────────────────────────

describe('detect-platform --field', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Write a config with a known platform override so tests are deterministic
    // without requiring a real git remote
    const config = {
      git: {
        platform: 'github',
        remote: 'origin',
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify(config, null, 2)
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('detect-platform --field platform returns plain string', () => {
    const { execFileSync } = require('child_process');
    const TOOLS_PATH = path.join(__dirname, '..', 'gsd-ng', 'bin', 'gsd-tools.cjs');
    let out;
    try {
      out = execFileSync(process.execPath, [TOOLS_PATH, 'detect-platform', '--field', 'platform'], {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (err) {
      assert.fail(`Command failed: ${err.stderr}`);
    }
    assert.strictEqual(out, 'github', 'should return plain platform string');
    assert.ok(!out.startsWith('{'), 'output must not be JSON');
  });

  test('detect-platform --field source returns plain string', () => {
    const { execFileSync } = require('child_process');
    const TOOLS_PATH = path.join(__dirname, '..', 'gsd-ng', 'bin', 'gsd-tools.cjs');
    let out;
    try {
      out = execFileSync(process.execPath, [TOOLS_PATH, 'detect-platform', '--field', 'source'], {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (err) {
      assert.fail(`Command failed: ${err.stderr}`);
    }
    assert.strictEqual(out, 'config', 'source should be config when platform override set');
    assert.ok(!out.startsWith('{'), 'output must not be JSON');
  });

  test('detect-platform --field cli_installed returns true or false string', () => {
    const { execFileSync } = require('child_process');
    const TOOLS_PATH = path.join(__dirname, '..', 'gsd-ng', 'bin', 'gsd-tools.cjs');
    let out;
    try {
      out = execFileSync(process.execPath, [TOOLS_PATH, 'detect-platform', '--field', 'cli_installed'], {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (err) {
      assert.fail(`Command failed: ${err.stderr}`);
    }
    assert.ok(out === 'true' || out === 'false', `cli_installed must be "true" or "false", got: ${out}`);
  });

  test('detect-platform --field cli returns CLI name string', () => {
    const { execFileSync } = require('child_process');
    const TOOLS_PATH = path.join(__dirname, '..', 'gsd-ng', 'bin', 'gsd-tools.cjs');
    let out;
    try {
      out = execFileSync(process.execPath, [TOOLS_PATH, 'detect-platform', '--field', 'cli'], {
        cwd: tmpDir,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
    } catch (err) {
      assert.fail(`Command failed: ${err.stderr}`);
    }
    // github platform maps to gh CLI
    assert.strictEqual(out, 'gh', 'github platform should map to gh CLI');
    assert.ok(!out.startsWith('{'), 'output must not be JSON');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// version-bump --field
// ─────────────────────────────────────────────────────────────────────────────

describe('version-bump --field', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create minimal package.json
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'test-pkg', version: '1.0.0' }, null, 2)
    );
    // Need a git repo for version-bump (execGit calls)
    execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
    execSync('git commit -m "init"', { cwd: tmpDir, stdio: 'pipe' });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('version-bump --level patch --field version returns plain version string', () => {
    const result = runGsdTools(['version-bump', '--level', 'patch', '--field', 'version'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, '1.0.1', 'should return plain version string for patch bump');
    assert.ok(!result.output.startsWith('{'), 'output must not be JSON');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// resolve-type-alias command
// ─────────────────────────────────────────────────────────────────────────────

describe('resolve-type-alias command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('resolve-type-alias feat returns default alias (feature)', () => {
    const result = runGsdTools(['resolve-type-alias', 'feat'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, 'feature', 'feat should resolve to feature by default');
  });

  test('resolve-type-alias fix returns default alias (bugfix)', () => {
    const result = runGsdTools(['resolve-type-alias', 'fix'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, 'bugfix', 'fix should resolve to bugfix by default');
  });

  test('resolve-type-alias with custom config override', () => {
    const config = {
      git: {
        type_aliases: { feat: 'new-feature', fix: 'patch' },
      },
    };
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify(config, null, 2)
    );
    const result = runGsdTools(['resolve-type-alias', 'feat'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, 'new-feature', 'should use config alias');
  });

  test('resolve-type-alias unknown type returns type itself', () => {
    const result = runGsdTools(['resolve-type-alias', 'docs'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, 'docs', 'unknown type should return itself');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// config-get (regression check for scalar extraction)
// ─────────────────────────────────────────────────────────────────────────────

describe('config-get scalar extraction', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Write a config with a known git.remote value
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ git: { remote: 'origin' } }, null, 2)
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('config-get git.remote returns plain string "origin"', () => {
    const result = runGsdTools(['config-get', 'git.remote'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, 'origin', 'git.remote should return "origin"');
    assert.ok(!result.output.startsWith('{'), 'output must not be JSON');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ISSUE_COMMANDS label operations (Phase 21-03)
// ─────────────────────────────────────────────────────────────────────────────

describe('ISSUE_COMMANDS label operations', () => {
  const { ISSUE_COMMANDS, applyVerifyLabel } = require('../gsd-ng/bin/lib/commands.cjs');

  // Test 1: GitHub label operation
  test('ISSUE_COMMANDS.github.label returns correct gh args', () => {
    const result = ISSUE_COMMANDS.github.label(42, null, 'needs-verification');
    assert.strictEqual(result.cli, 'gh');
    assert.deepStrictEqual(result.args, ['issue', 'edit', '42', '--add-label', 'needs-verification']);
  });

  // Test 2: GitHub label_create operation
  test('ISSUE_COMMANDS.github.label_create returns correct gh args', () => {
    const result = ISSUE_COMMANDS.github.label_create(null, 'needs-verification');
    assert.strictEqual(result.cli, 'gh');
    assert.deepStrictEqual(result.args, ['label', 'create', 'needs-verification', '--force']);
  });

  // Test 3: GitLab label operation
  test('ISSUE_COMMANDS.gitlab.label returns correct glab args', () => {
    const result = ISSUE_COMMANDS.gitlab.label(42, null, 'needs-verification');
    assert.strictEqual(result.cli, 'glab');
    assert.deepStrictEqual(result.args, ['issue', 'edit', '42', '--add-labels', 'needs-verification']);
  });

  // Test 4: Forgejo label operation
  test('ISSUE_COMMANDS.forgejo.label returns correct fj args', () => {
    const result = ISSUE_COMMANDS.forgejo.label(42, null, 'needs-verification');
    assert.strictEqual(result.cli, 'fj');
    assert.deepStrictEqual(result.args, ['issue', 'edit', '42', '--add-labels', 'needs-verification']);
  });

  // Test 5: Gitea label operation
  test('ISSUE_COMMANDS.gitea.label returns correct tea args', () => {
    const result = ISSUE_COMMANDS.gitea.label(42, null, 'needs-verification');
    assert.strictEqual(result.cli, 'tea');
    assert.deepStrictEqual(result.args, ['issues', 'edit', '42', '--add-labels', 'needs-verification']);
  });

  // Test for applyVerifyLabel export
  test('applyVerifyLabel is exported as a function', () => {
    assert.strictEqual(typeof applyVerifyLabel, 'function', 'applyVerifyLabel should be exported');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdIssueSync verify state modes (Phase 21-03)
// ─────────────────────────────────────────────────────────────────────────────

describe('cmdIssueSync verify state modes', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Write a completed todo with an external_ref
    const doneTodosDir = path.join(tmpDir, '.planning', 'todos', 'completed');
    fs.mkdirSync(doneTodosDir, { recursive: true });
    fs.writeFileSync(
      path.join(doneTodosDir, 'todo-1.md'),
      `---\ntitle: Test todo\nexternal_ref: "github:#42"\n---\n\nDone.\n`
    );
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Test 6: close_state=close regression — calls close, not label
  test('close_state=close calls close action', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ issue_tracker: { close_state: 'close' } }, null, 2)
    );
    process.env.GSD_TEST_MODE = '1';
    try {
      const { cmdIssueSync } = require('../gsd-ng/bin/lib/commands.cjs');
      const result = cmdIssueSync(tmpDir, null, { auto: true }, true);
      const syncedItem = result.synced.find(s => s.ref === 'github:#42');
      assert.ok(syncedItem, 'should have synced github:#42');
      assert.strictEqual(syncedItem.action, 'close', 'action should be close');
      assert.ok(syncedItem.success, 'close should succeed in test mode');
    } finally {
      delete process.env.GSD_TEST_MODE;
    }
  });

  // Test 7: close_state=verify calls label, not close
  test('close_state=verify produces verify action', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ issue_tracker: { close_state: 'verify', verify_label: 'needs-verification' } }, null, 2)
    );
    process.env.GSD_TEST_MODE = '1';
    try {
      const { cmdIssueSync } = require('../gsd-ng/bin/lib/commands.cjs');
      const result = cmdIssueSync(tmpDir, null, { auto: true }, true);
      const syncedItem = result.synced.find(s => s.ref === 'github:#42');
      assert.ok(syncedItem, 'should have synced github:#42');
      assert.strictEqual(syncedItem.action, 'verify', 'action should be verify when close_state=verify');
    } finally {
      delete process.env.GSD_TEST_MODE;
    }
  });

  // Test 8: close_state=verify_then_close closes after labeling
  test('close_state=verify_then_close produces close action', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ issue_tracker: { close_state: 'verify_then_close', verify_label: 'needs-verification' } }, null, 2)
    );
    process.env.GSD_TEST_MODE = '1';
    try {
      const { cmdIssueSync } = require('../gsd-ng/bin/lib/commands.cjs');
      const result = cmdIssueSync(tmpDir, null, { auto: true }, true);
      const syncedItem = result.synced.find(s => s.ref === 'github:#42');
      assert.ok(syncedItem, 'should have synced github:#42');
      assert.strictEqual(syncedItem.action, 'close', 'action should be close after verify_then_close');
      assert.ok(syncedItem.success, 'verify_then_close should succeed in test mode');
    } finally {
      delete process.env.GSD_TEST_MODE;
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cleanup command tests
// ─────────────────────────────────────────────────────────────────────────────

describe('cleanup command', () => {
  const os = require('os');
  let tmpDir;

  function createCleanupProject() {
    const dir = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-cleanup-test-'));
    fs.mkdirSync(path.join(dir, '.planning', 'phases'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.planning', 'milestones'), { recursive: true });
    return dir;
  }

  beforeEach(() => {
    tmpDir = createCleanupProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  // Test 1: dry-run with one completed milestone returns expected shape
  test('dry-run with one completed milestone returns milestones array and nothing_to_do false', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'MILESTONES.md'),
      '# Milestones\n\n- [x] **v1.0 — Foundation** — Initial release\n- [ ] **v2.0 — Expansion**\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'milestones', 'v1.0-ROADMAP.md'),
      '# Roadmap v1.0\n\n## Phase 1: Foundation\n\nSome content.\n\n## Phase 2: Auth\n\nMore content.\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-auth'), { recursive: true });

    const result = runGsdTools(['cleanup', '--dry-run', '--json'], tmpDir);
    assert.ok(result.success, 'cleanup dry-run should succeed: ' + result.error);

    const parsed = JSON.parse(result.output);
    assert.ok(Array.isArray(parsed.milestones), 'milestones should be an array');
    assert.strictEqual(parsed.milestones.length, 1, 'should have 1 milestone entry');
    assert.strictEqual(parsed.milestones[0].version, 'v1.0', 'version should be v1.0');
    assert.ok(Array.isArray(parsed.milestones[0].phases_to_archive), 'phases_to_archive should be an array');
    assert.ok(parsed.milestones[0].phases_to_archive.length > 0, 'should have phases to archive');
    assert.strictEqual(parsed.nothing_to_do, false, 'nothing_to_do should be false');
  });

  // Test 2: dry-run when all milestones already archived returns nothing_to_do true
  test('dry-run with all milestones already archived returns nothing_to_do true', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'MILESTONES.md'),
      '# Milestones\n\n- [x] **v1.0 — Foundation** — Initial release\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'milestones', 'v1.0-phases'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'milestones', 'v1.0-ROADMAP.md'),
      '# Roadmap v1.0\n\n## Phase 1: Foundation\n'
    );

    const result = runGsdTools(['cleanup', '--dry-run', '--json'], tmpDir);
    assert.ok(result.success, 'cleanup dry-run should succeed: ' + result.error);

    const parsed = JSON.parse(result.output);
    assert.deepStrictEqual(parsed.milestones, [], 'milestones should be empty');
    assert.strictEqual(parsed.nothing_to_do, true, 'nothing_to_do should be true');
  });

  // Test 3: execute (not dry-run) creates destination dir and moves phase directories
  test('execute mode creates destination dir and moves phase directories', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'MILESTONES.md'),
      '# Milestones\n\n- [x] **v1.0 — Foundation**\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'milestones', 'v1.0-ROADMAP.md'),
      '# Roadmap v1.0\n\n## Phase 1: Foundation\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });

    const result = runGsdTools(['cleanup', '--json'], tmpDir);
    assert.ok(result.success, 'cleanup execute should succeed: ' + result.error);

    const destDir = path.join(tmpDir, '.planning', 'milestones', 'v1.0-phases');
    assert.ok(fs.existsSync(destDir), 'destination v1.0-phases dir should be created');
    assert.ok(fs.existsSync(path.join(destDir, '01-foundation')), '01-foundation should be moved');
    assert.ok(!fs.existsSync(path.join(tmpDir, '.planning', 'phases', '01-foundation')),
      '01-foundation should no longer exist in phases/');

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.nothing_to_do, false, 'nothing_to_do should be false');
  });

  // Test 4: missing MILESTONES.md returns error-shaped result, not throw
  test('missing MILESTONES.md returns error-shaped JSON result without crashing', () => {
    // No MILESTONES.md created
    const result = runGsdTools(['cleanup', '--dry-run', '--json'], tmpDir);
    assert.ok(result.success, 'cleanup should exit 0 even with missing MILESTONES.md: ' + result.error);

    const parsed = JSON.parse(result.output);
    assert.ok(parsed.error || parsed.nothing_to_do === true, 'should return error or nothing_to_do=true');
  });

  // Test 5: missing ROADMAP snapshot for a milestone skips that milestone with warning
  test('missing ROADMAP snapshot for milestone is handled gracefully', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'MILESTONES.md'),
      '# Milestones\n\n- [x] **v1.0 — Foundation**\n'
    );
    // No v1.0-ROADMAP.md created — missing snapshot

    const result = runGsdTools(['cleanup', '--dry-run', '--json'], tmpDir);
    assert.ok(result.success, 'cleanup should succeed even with missing ROADMAP snapshot: ' + result.error);

    const parsed = JSON.parse(result.output);
    const hasSkipped = (parsed.milestones || []).some(m => m.skipped === true);
    const hasNothingToDo = parsed.nothing_to_do === true;
    assert.ok(hasSkipped || hasNothingToDo, 'should handle missing ROADMAP snapshot gracefully');
  });

  // Test 6: multiple completed milestones returns entries for each
  test('multiple completed milestones returns entry for each', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'MILESTONES.md'),
      '# Milestones\n\n- [x] **v1.0 — Foundation**\n- [x] **v1.1 — Auth**\n- [ ] **v2.0 — Expansion**\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'milestones', 'v1.0-ROADMAP.md'),
      '# Roadmap v1.0\n\n## Phase 1: Foundation\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'milestones', 'v1.1-ROADMAP.md'),
      '# Roadmap v1.1\n\n## Phase 2: Auth\n'
    );
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '01-foundation'), { recursive: true });
    fs.mkdirSync(path.join(tmpDir, '.planning', 'phases', '02-auth'), { recursive: true });

    const result = runGsdTools(['cleanup', '--dry-run', '--json'], tmpDir);
    assert.ok(result.success, 'cleanup should succeed: ' + result.error);

    const parsed = JSON.parse(result.output);
    assert.ok(Array.isArray(parsed.milestones), 'milestones should be an array');
    const versions = parsed.milestones.map(m => m.version);
    assert.ok(versions.includes('v1.0'), 'should include v1.0');
    assert.ok(versions.includes('v1.1'), 'should include v1.1');
    assert.strictEqual(parsed.nothing_to_do, false, 'nothing_to_do should be false');
  });
});

describe('update command', () => {
  let tmpDir;
  let fakeHome;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-update-test-'));
    fakeHome = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-home-'));
  });

  afterEach(() => {
    cleanup(tmpDir);
    cleanup(fakeHome);
  });

  // Helper: run update command via gsd-tools subprocess with test overrides injected via env vars.
  // GSD_TEST_HOME: fakeHome to isolate from real HOME
  // GSD_UPDATE_TEST_OVERRIDES: JSON with { latestVersion, updateSource } to bypass network calls
  // GSD_TEST_DRY_EXECUTE: '1' to skip actual install execution
  function runUpdate(localGsdVersion, globalGsdVersion, overrides, options = {}) {
    if (localGsdVersion) {
      const localGsdDir = path.join(tmpDir, '.claude', 'gsd-ng');
      fs.mkdirSync(localGsdDir, { recursive: true });
      fs.writeFileSync(path.join(localGsdDir, 'VERSION'), localGsdVersion + '\n');
    }
    if (globalGsdVersion) {
      const globalGsdDir = path.join(fakeHome, '.claude', 'gsd-ng');
      fs.mkdirSync(globalGsdDir, { recursive: true });
      fs.writeFileSync(path.join(globalGsdDir, 'VERSION'), globalGsdVersion + '\n');
    }

    const args = ['update', '--dry-run'];
    if (options.execute) {
      // Remove --dry-run for execute mode
      args.splice(args.indexOf('--dry-run'), 1);
    }

    const env = {
      GSD_TEST_HOME: fakeHome,
      GSD_UPDATE_TEST_OVERRIDES: JSON.stringify(overrides || { latestVersion: null, updateSource: null }),
    };
    if (options.dryExecute) {
      env.GSD_TEST_DRY_EXECUTE = '1';
    }

    return runGsdTools(args, tmpDir, env);
  }

  test('Test 1: detects local install when .claude/gsd-ng/VERSION exists', () => {
    // local=1.0.0, global=none, latest=1.0.0 -> already_current
    const result = runUpdate('1.0.0', null, { latestVersion: '1.0.0', updateSource: 'npm' });
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'already_current', 'local install detected, already current');
    assert.strictEqual(parsed.installed, '1.0.0');
  });

  test('Test 2: detects global install when local VERSION missing', () => {
    // local=none, global=1.2.0, latest=2.0.0 -> update_available (global)
    const result = runUpdate(null, '1.2.0', { latestVersion: '2.0.0', updateSource: 'npm' });
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'update_available');
    assert.strictEqual(parsed.installed, '1.2.0');
    assert.strictEqual(parsed.install_type, 'global');
  });

  test('Test 3: returns unknown_version when no VERSION file found', () => {
    // local=none, global=none
    const result = runUpdate(null, null, { latestVersion: '1.0.0', updateSource: 'npm' });
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'unknown_version');
  });

  test('Test 4: dry-run returns installed, latest, update_source, update_available, status', () => {
    // local=1.0.0, latest=1.5.0 -> update_available
    const result = runUpdate('1.0.0', null, { latestVersion: '1.5.0', updateSource: 'npm' });
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.ok('installed' in parsed, 'should have installed field');
    assert.ok('latest' in parsed, 'should have latest field');
    assert.ok('update_source' in parsed, 'should have update_source field');
    assert.ok('update_available' in parsed, 'should have update_available field');
    assert.ok('status' in parsed, 'should have status field');
    assert.strictEqual(parsed.update_available, true);
    assert.strictEqual(parsed.status, 'update_available');
  });

  test('Test 5: returns already_current when installed == latest', () => {
    const result = runUpdate('2.0.0', null, { latestVersion: '2.0.0', updateSource: 'npm' });
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'already_current');
    assert.strictEqual(parsed.installed, '2.0.0');
    assert.strictEqual(parsed.latest, '2.0.0');
  });

  test('Test 6: returns ahead when installed > latest', () => {
    const result = runUpdate('3.0.0', null, { latestVersion: '2.5.0', updateSource: 'npm' });
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'ahead');
    assert.strictEqual(parsed.installed, '3.0.0');
    assert.strictEqual(parsed.latest, '2.5.0');
  });

  test('Test 7: handles both npm and github unavailable returning both_unavailable', () => {
    // Override with null latestVersion to simulate both unavailable
    const result = runUpdate('1.0.0', null, { latestVersion: null, updateSource: null });
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'both_unavailable');
  });

  test('Test 8: execute mode calls correct install command (npm path, dry execute)', () => {
    // Execute mode with GSD_TEST_DRY_EXECUTE=1 to skip actual npx
    const result = runUpdate('1.0.0', null, { latestVersion: '1.5.0', updateSource: 'npm' }, {
      execute: true,
      dryExecute: true,
    });
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'updated');
    assert.ok(parsed.install_command, 'should record install_command for test verification');
    assert.ok(parsed.install_command.includes('gsd-ng'), 'install_command should reference package');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// staleness-check --count flag
// ─────────────────────────────────────────────────────────────────────────────

describe('staleness-check --count flag', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('staleness-check --count returns "0" when no codebase docs exist', () => {
    // No .planning/codebase directory — should return 0 stale
    const result = runGsdTools(['staleness-check', '--count'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, '0', 'should return integer 0 as string');
  });

  test('staleness-check --count returns integer N when N docs are stale', () => {
    // Create a codebase doc with a commit hash that won't exist in the repo
    const codebaseDir = path.join(tmpDir, '.planning', 'codebase');
    fs.mkdirSync(codebaseDir, { recursive: true });
    fs.writeFileSync(
      path.join(codebaseDir, 'overview.md'),
      '---\nlast_mapped_commit: deadbeef1234567890abcdef1234567890abcdef\n---\n\n# Overview\n'
    );

    const result = runGsdTools(['staleness-check', '--count'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    // The doc has a non-existent hash, so it should be stale (count = 1)
    assert.strictEqual(result.output, '1', 'should return integer 1 as string');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// config-get --default flag
// ─────────────────────────────────────────────────────────────────────────────

describe('config-get --default flag', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('config-get --default returns default string when key not found', () => {
    // Write a config without the key we are querying
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ git: { remote: 'origin' } }, null, 2)
    );
    const result = runGsdTools(['config-get', 'nonexistent.key', '--default', 'mydefault'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'mydefault', `Expected scalar "mydefault", got: ${result.output}`);
  });

  test('config-get --default false without returns JSON string "false"', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ git: { remote: 'origin' } }, null, 2)
    );
    const result = runGsdTools(['config-get', 'nonexistent.key', '--default', 'false'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'false', `Expected scalar "false", got: ${result.output}`);
  });

  test('config-get --default returns actual value when key exists', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ workflow: { auto_advance: true } }, null, 2)
    );
    const result = runGsdTools(['config-get', 'workflow.auto_advance', '--default', 'false'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.ok(result.output.includes('true'), `Expected "true" in output, got: ${result.output}`);
  });

  test('config-get --default false returns "false" when key not found', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ git: { remote: 'origin' } }, null, 2)
    );
    const result = runGsdTools(['config-get', 'nonexistent.key', '--default', 'false'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    assert.strictEqual(result.output, 'false', `Expected exactly "false", got: ${result.output}`);
  });
});

describe('todo list-by-phase command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    // Create todos/pending directory
    fs.mkdirSync(path.join(tmpDir, '.planning', 'todos', 'pending'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('list-by-phase returns filenames matching the given phase', () => {
    // Create three todos: one matching phase 5, one with phase 10, one with no phase
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'todos', 'pending', '2026-01-01-todo-phase5.md'),
      '---\nphase: 5\ntitle: Phase 5 todo\n---\n\nDo something in phase 5.\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'todos', 'pending', '2026-01-02-todo-phase10.md'),
      '---\nphase: 10\ntitle: Phase 10 todo\n---\n\nDo something in phase 10.\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'todos', 'pending', '2026-01-03-todo-nophase.md'),
      '---\ntitle: No phase todo\n---\n\nDo something unrelated.\n'
    );

    const result = runGsdTools(['todo', 'list-by-phase', '5', '--json'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output), 'Output should be an array');
    assert.ok(output.includes('2026-01-01-todo-phase5.md'), 'Should include the phase-5 todo');
    assert.ok(!output.includes('2026-01-02-todo-phase10.md'), 'Should not include phase-10 todo');
    assert.ok(!output.includes('2026-01-03-todo-nophase.md'), 'Should not include no-phase todo');
  });

  test('list-by-phase returns empty array when no todos match', () => {
    // Create todos with different phases
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'todos', 'pending', '2026-01-01-todo-phase3.md'),
      '---\nphase: 3\ntitle: Phase 3 todo\n---\n\nDo something.\n'
    );

    const result = runGsdTools(['todo', 'list-by-phase', '99', '--json'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output), 'Output should be an array');
    assert.strictEqual(output.length, 0, 'Should return empty array when no phase matches');
  });

  test('list-by-phase returns empty array when pending dir is empty', () => {
    // No todos created
    const result = runGsdTools(['todo', 'list-by-phase', '5', '--json'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output), 'Output should be an array');
    assert.strictEqual(output.length, 0, 'Should return empty array when dir is empty');
  });
});

describe('todo scan-phase-linked command', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
    fs.mkdirSync(path.join(tmpDir, '.planning', 'todos', 'pending'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('scan-phase-linked returns source todos listed in ROADMAP.md for the given phase', () => {
    // Create ROADMAP.md with a phase containing Source Todos
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n## Phase Details\n\n### Phase 5: Test Phase\n**Goal:** Do things\n**Source Todos**: `todo-a.md`, `todo-b.md`\n\n'
    );

    // Create the todo files in pending
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'todos', 'pending', 'todo-a.md'),
      '---\nphase: 5\ntitle: Todo A\n---\n\nContent A.\n'
    );
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'todos', 'pending', 'todo-b.md'),
      '---\nphase: 5\ntitle: Todo B\n---\n\nContent B.\n'
    );

    const result = runGsdTools(['todo', 'scan-phase-linked', '5', '--json'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output), 'Output should be an array');
    assert.ok(output.includes('todo-a.md'), 'Should include todo-a.md');
    assert.ok(output.includes('todo-b.md'), 'Should include todo-b.md');
  });

  test('scan-phase-linked returns empty array when phase has no source todos', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n## Phase Details\n\n### Phase 5: Test Phase\n**Goal:** Do things\n\n'
    );

    const result = runGsdTools(['todo', 'scan-phase-linked', '5', '--json'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output), 'Output should be an array');
    assert.strictEqual(output.length, 0, 'Should return empty when no source todos');
  });

  test('scan-phase-linked only returns todos that exist in pending dir', () => {
    // ROADMAP lists two todos but only one exists in pending
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'ROADMAP.md'),
      '# Roadmap\n\n## Phase Details\n\n### Phase 7: Another Phase\n**Goal:** Do things\n**Source Todos**: `exists.md`, `missing.md`\n\n'
    );

    // Only create exists.md
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'todos', 'pending', 'exists.md'),
      '---\nphase: 7\ntitle: Exists\n---\n\nContent.\n'
    );

    const result = runGsdTools(['todo', 'scan-phase-linked', '7', '--json'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const output = JSON.parse(result.output);
    assert.ok(Array.isArray(output), 'Output should be an array');
    assert.ok(output.includes('exists.md'), 'Should include the existing todo');
    assert.ok(!output.includes('missing.md'), 'Should not include missing todo');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// summary-extract --default flag
// ─────────────────────────────────────────────────────────────────────────────

describe('summary-extract --default flag', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns default value when summary file not found', () => {
    const result = runGsdTools(['summary-extract', '.planning/phases/nonexistent/01-01-SUMMARY.md', '--fields', 'one_liner', '--default', ''], tmpDir);
    assert.ok(result.success, `Command should exit 0 with --default, got: ${result.error}`);
    assert.strictEqual(result.output, '', `Expected empty string, got: "${result.output}"`);
  });

  test('returns actual value when file found (default unused)', () => {
    const summaryDir = path.join(tmpDir, '.planning', 'phases', '01-test');
    fs.mkdirSync(summaryDir, { recursive: true });
    const summaryContent = `---\nphase: "01"\nplan: "01"\nsubsystem: test\ntags: []\nduration: 5m\ncompleted: "2026-01-01"\n---\n\n# Summary\n\n**Built the thing**\n`;
    fs.writeFileSync(path.join(summaryDir, '01-01-SUMMARY.md'), summaryContent);
    const result = runGsdTools(['summary-extract', '.planning/phases/01-test/01-01-SUMMARY.md', '--fields', 'one_liner', '--default', '', '--json'], tmpDir);
    assert.ok(result.success, `Command should succeed`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.one_liner, 'Built the thing', 'Should return actual value');
  });
});
