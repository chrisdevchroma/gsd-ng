/**
 * GSD Tools Tests — Workspace Detection and Memory Helpers
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// detectWorkspaceType — workspace topology detection
// ─────────────────────────────────────────────────────────────────────────────

describe('detectWorkspaceType', () => {
  // Import directly for unit tests
  const workspace = require('../get-shit-done/bin/lib/workspace.cjs');
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns submodule when .gitmodules exists', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitmodules'), '[submodule "foo"]\n  path = foo\n  url = https://example.com\n');
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.strictEqual(result.type, 'submodule');
    assert.strictEqual(result.signal, '.gitmodules');
  });

  test('returns monorepo with pnpm signal when pnpm-workspace.yaml exists', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.strictEqual(result.type, 'monorepo');
    assert.strictEqual(result.signal, 'pnpm-workspace.yaml');
  });

  test('returns monorepo with package.json#workspaces when package.json has workspaces array', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-monorepo', workspaces: ['packages/*'] })
    );
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.strictEqual(result.type, 'monorepo');
    assert.strictEqual(result.signal, 'package.json#workspaces');
  });

  test('returns monorepo with package.json#workspaces when package.json has workspaces object (yarn berry)', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-monorepo', workspaces: { packages: ['packages/*'] } })
    );
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.strictEqual(result.type, 'monorepo');
    assert.strictEqual(result.signal, 'package.json#workspaces');
  });

  test('returns standalone when no workspace signals are present', () => {
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.strictEqual(result.type, 'standalone');
    assert.strictEqual(result.signal, null);
  });

  test('returns standalone when package.json exists but has no workspaces field', () => {
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-app', version: '1.0.0' })
    );
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.strictEqual(result.type, 'standalone');
    assert.strictEqual(result.signal, null);
  });

  test('.gitmodules takes priority over package.json workspaces (submodule wins over monorepo)', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitmodules'), '[submodule "foo"]\n  path = foo\n  url = https://example.com\n');
    fs.writeFileSync(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({ name: 'my-monorepo', workspaces: ['packages/*'] })
    );
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.strictEqual(result.type, 'submodule');
    assert.strictEqual(result.signal, '.gitmodules');
  });

  test('returns submodule_paths with parsed paths when .gitmodules exists', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitmodules'),
      '[submodule "foo"]\n\tpath = foo\n\turl = https://example.com\n');
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.strictEqual(result.type, 'submodule');
    assert.deepStrictEqual(result.submodule_paths, ['foo']);
  });

  test('returns multiple submodule_paths when .gitmodules has multiple entries', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitmodules'),
      '[submodule "a"]\n\tpath = a\n\turl = https://example.com/a\n' +
      '[submodule "b"]\n\tpath = b\n\turl = https://example.com/b\n');
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.deepStrictEqual(result.submodule_paths, ['a', 'b']);
  });

  test('returns empty submodule_paths for standalone workspace', () => {
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.deepStrictEqual(result.submodule_paths, []);
  });

  test('returns empty submodule_paths for monorepo workspace', () => {
    fs.writeFileSync(path.join(tmpDir, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    const result = workspace.detectWorkspaceType(tmpDir);
    assert.deepStrictEqual(result.submodule_paths, []);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateMemoriesSection — CLAUDE.md Memories section builder
// ─────────────────────────────────────────────────────────────────────────────

describe('generateMemoriesSection', () => {
  const workspace = require('../get-shit-done/bin/lib/workspace.cjs');
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns markdown string with heading, intro line, and bullet list from memory files', () => {
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, 'feedback_example.md'),
      '---\nname: Example Feedback\ndescription: This is an example memory\ntype: feedback\n---\n\nContent here.\n'
    );

    const result = workspace.generateMemoriesSection(tmpDir);
    assert.ok(result.includes('## Memories'), 'should include ## Memories heading');
    assert.ok(result.includes('`.claude/memory/`'), 'should mention the memory directory');
    assert.ok(result.includes('feedback_example.md'), 'should list the memory file');
    assert.ok(result.includes('This is an example memory'), 'should include the description');
  });

  test('uses frontmatter description field for bullet description', () => {
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, 'feedback_test.md'),
      '---\nname: Test Name\ndescription: My specific description\ntype: feedback\n---\n\nBody.\n'
    );

    const result = workspace.generateMemoriesSection(tmpDir);
    assert.ok(result.includes('My specific description'), 'should use description field');
    assert.ok(!result.includes('Test Name') || result.includes('My specific description'), 'should prefer description over name');
  });

  test('falls back to name field when description is missing', () => {
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, 'feedback_noname.md'),
      '---\nname: Fallback Name\ntype: feedback\n---\n\nBody.\n'
    );

    const result = workspace.generateMemoriesSection(tmpDir);
    assert.ok(result.includes('Fallback Name'), 'should fall back to name field');
  });

  test('falls back to (no description) when neither description nor name is present', () => {
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, 'feedback_empty.md'),
      '---\ntype: feedback\n---\n\nBody.\n'
    );

    const result = workspace.generateMemoriesSection(tmpDir);
    assert.ok(result.includes('(no description)'), 'should use fallback text');
  });

  test('skips MEMORY.md in the bullet listing', () => {
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, 'MEMORY.md'),
      '# Memory Index\n\n## Feedback\n- [example.md](example.md)\n'
    );
    fs.writeFileSync(
      path.join(memoryDir, 'feedback_real.md'),
      '---\nname: Real Memory\ndescription: Real description\ntype: feedback\n---\n\nContent.\n'
    );

    const result = workspace.generateMemoriesSection(tmpDir);
    assert.ok(!result.includes('MEMORY.md'), 'should not list MEMORY.md');
    assert.ok(result.includes('feedback_real.md'), 'should still list other files');
  });

  test('returns empty string when .claude/memory/ does not exist', () => {
    const result = workspace.generateMemoriesSection(tmpDir);
    assert.strictEqual(result, '', 'should return empty string for missing directory');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// generateMemoryMd — MEMORY.md content builder
// ─────────────────────────────────────────────────────────────────────────────

describe('generateMemoryMd', () => {
  const workspace = require('../get-shit-done/bin/lib/workspace.cjs');
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('returns categorized MEMORY.md content string grouped by type field', () => {
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, 'feedback_one.md'),
      '---\nname: Feedback One\ndescription: A feedback entry\ntype: feedback\n---\n\nContent.\n'
    );
    fs.writeFileSync(
      path.join(memoryDir, 'project_context.md'),
      '---\nname: Project Context\ndescription: Project memory\ntype: project\n---\n\nContent.\n'
    );

    const result = workspace.generateMemoryMd(tmpDir);
    assert.ok(result.includes('# Memory Index'), 'should include Memory Index heading');
    assert.ok(result.includes('## Feedback'), 'should include Feedback section');
    assert.ok(result.includes('## Project'), 'should include Project section');
    assert.ok(result.includes('feedback_one.md'), 'should list feedback file');
    assert.ok(result.includes('project_context.md'), 'should list project file');
  });

  test('filters out MEMORY.md from the listing', () => {
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, 'MEMORY.md'),
      '# Memory Index\n'
    );
    fs.writeFileSync(
      path.join(memoryDir, 'feedback_real.md'),
      '---\nname: Real\ndescription: Real entry\ntype: feedback\n---\n\nContent.\n'
    );

    const result = workspace.generateMemoryMd(tmpDir);
    assert.ok(!result.includes('MEMORY.md'), 'should not include MEMORY.md in listing');
    assert.ok(result.includes('feedback_real.md'), 'should include other files');
  });

  test('returns empty string when no memory files exist', () => {
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    // Only MEMORY.md which should be filtered
    fs.writeFileSync(path.join(memoryDir, 'MEMORY.md'), '# Memory Index\n');

    const result = workspace.generateMemoryMd(tmpDir);
    assert.strictEqual(result, '', 'should return empty string when no qualifying files');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// seedMemoryTemplate — template file seeding
// ─────────────────────────────────────────────────────────────────────────────

describe('seedMemoryTemplate', () => {
  const workspace = require('../get-shit-done/bin/lib/workspace.cjs');
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('copies template to target directory with correct filename', () => {
    // Create a template file
    const templateDir = path.join(tmpDir, 'templates');
    fs.mkdirSync(templateDir, { recursive: true });
    const templatePath = path.join(templateDir, 'multi-boundary.md');
    fs.writeFileSync(templatePath, '---\nname: Test Template\ntype: feedback\n---\n\nTemplate content.\n');

    const targetDir = path.join(tmpDir, '.claude', 'memory');
    const result = workspace.seedMemoryTemplate(templatePath, targetDir, 'project_commit-boundary.md');

    assert.strictEqual(result.seeded, true, 'should report seeded: true');
    assert.ok(result.path, 'should return path');
    assert.ok(result.path.includes('project_commit-boundary.md'), 'path should include target filename');
    assert.ok(fs.existsSync(result.path), 'output file should exist on disk');

    const content = fs.readFileSync(result.path, 'utf-8');
    assert.ok(content.includes('Template content.'), 'file should contain template content');
  });

  test('creates target directory if it does not exist', () => {
    const templateDir = path.join(tmpDir, 'templates');
    fs.mkdirSync(templateDir, { recursive: true });
    const templatePath = path.join(templateDir, 'sample.md');
    fs.writeFileSync(templatePath, '# Sample\n');

    const targetDir = path.join(tmpDir, '.claude', 'memory', 'subdir');
    assert.ok(!fs.existsSync(targetDir), 'target dir should not exist yet');

    const result = workspace.seedMemoryTemplate(templatePath, targetDir, 'sample.md');
    assert.strictEqual(result.seeded, true, 'should create dir and seed file');
    assert.ok(fs.existsSync(targetDir), 'target directory should now exist');
  });

  test('returns seeded: false when template file does not exist', () => {
    const templatePath = path.join(tmpDir, 'nonexistent-template.md');
    const targetDir = path.join(tmpDir, '.claude', 'memory');

    const result = workspace.seedMemoryTemplate(templatePath, targetDir, 'output.md');
    assert.strictEqual(result.seeded, false, 'should report seeded: false');
    assert.ok(result.reason, 'should include a reason');
    assert.ok(result.reason.includes('template not found'), 'reason should mention template not found');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// end-to-end pipeline — integration tests for full seeding pipeline
// ─────────────────────────────────────────────────────────────────────────────

describe('end-to-end pipeline', () => {
  const workspace = require('../get-shit-done/bin/lib/workspace.cjs');
  const { cmdValidateHealth } = require('../get-shit-done/bin/lib/verify.cjs');
  const TEMPLATE_PATH = path.join(__dirname, '..', 'get-shit-done', 'templates', 'memory-templates', 'multi-boundary.md');
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('seed-memories pipeline creates memory file and CLAUDE.md for submodule workspace', () => {
    // Set up submodule workspace
    fs.writeFileSync(
      path.join(tmpDir, '.gitmodules'),
      '[submodule "foo"]\n  path = foo\n  url = https://example.com\n'
    );
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    // Step 1: seed the template
    const seedResult = workspace.seedMemoryTemplate(TEMPLATE_PATH, memoryDir, 'project_commit-boundary.md');
    assert.strictEqual(seedResult.seeded, true, 'seedMemoryTemplate should succeed');

    // Step 2: seeded file exists on disk with correct content
    const seededFilePath = path.join(memoryDir, 'project_commit-boundary.md');
    assert.ok(fs.existsSync(seededFilePath), 'seeded file should exist on disk');
    const seededContent = fs.readFileSync(seededFilePath, 'utf-8');
    assert.ok(seededContent.includes('multiple code boundaries'), 'seeded file should contain template text');

    // Step 3: generateMemoriesSection returns section with heading
    const memoriesSection = workspace.generateMemoriesSection(tmpDir);
    assert.ok(memoriesSection.includes('## Memories'), 'generateMemoriesSection should include ## Memories heading');
    assert.ok(memoriesSection.includes('project_commit-boundary.md'), 'section should reference the seeded file');

    // Step 4: generateMemoryMd returns content referencing the seeded file
    const memoryMd = workspace.generateMemoryMd(tmpDir);
    assert.ok(memoryMd.includes('project_commit-boundary.md'), 'MEMORY.md content should reference seeded file');
  });

  test('standalone workspace gets no template and empty MEMORY.md', () => {
    // No workspace signals: no .gitmodules, no pnpm-workspace.yaml, no workspaces in package.json
    const wsResult = workspace.detectWorkspaceType(tmpDir);
    assert.strictEqual(wsResult.type, 'standalone', 'should detect standalone type');

    // Empty memory dir (no qualifying files)
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });

    const memoryMd = workspace.generateMemoryMd(tmpDir);
    assert.strictEqual(memoryMd, '', 'generateMemoryMd should return empty string for empty memory dir');
  });

  test('health check detects topology drift in non-standalone workspace without structural memory', () => {
    // Set up submodule workspace
    fs.writeFileSync(
      path.join(tmpDir, '.gitmodules'),
      '[submodule "foo"]\n  path = foo\n  url = https://example.com\n'
    );

    // Create memory dir with only unrelated memory file (no boundary keywords)
    const memoryDir = path.join(tmpDir, '.claude', 'memory');
    fs.mkdirSync(memoryDir, { recursive: true });
    fs.writeFileSync(
      path.join(memoryDir, 'unrelated.md'),
      'some unrelated note\n'
    );

    // Create CLAUDE.md that references the unrelated memory file
    fs.writeFileSync(
      path.join(tmpDir, 'CLAUDE.md'),
      '## Memories\n\nRead .claude/memory/ for context.\n\n- [.claude/memory/unrelated.md](.claude/memory/unrelated.md) -- some note\n'
    );

    // Run health check and capture output
    let capturedOutput = null;
    const origOutput = require('../get-shit-done/bin/lib/core.cjs').output;

    // Use runGsdTools CLI (gsd-tools validate health) to avoid process.exit(0) side effects
    const result = runGsdTools(['validate', 'health', '--cwd', tmpDir], tmpDir);

    assert.ok(result.output, 'health check should produce output');
    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(result.output);
    }, 'health output should be valid JSON');

    const allIssues = [...(parsed.warnings || []), ...(parsed.errors || []), ...(parsed.info || [])];
    const w014 = allIssues.find(i => i.code === 'W014');
    assert.ok(w014, `Expected W014 issue in health check output. Got: ${JSON.stringify(allIssues)}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// cmdDetectWorkspace — CLI integration via gsd-tools
// ─────────────────────────────────────────────────────────────────────────────

describe('cmdDetectWorkspace via gsd-tools', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempProject();
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('outputs valid JSON with type and signal fields', () => {
    const result = runGsdTools(['detect-workspace', '--cwd', tmpDir], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(result.output);
    }, 'output should be valid JSON');

    assert.ok('type' in parsed, 'result should have type field');
    assert.ok('signal' in parsed, 'result should have signal field');
  });

  test('reports submodule type for project with .gitmodules', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitmodules'), '[submodule "foo"]\n  path = foo\n  url = https://example.com\n');

    const result = runGsdTools(['detect-workspace', '--cwd', tmpDir], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.type, 'submodule');
    assert.strictEqual(parsed.signal, '.gitmodules');
  });

  test('reports standalone for project without workspace signals', () => {
    const result = runGsdTools(['detect-workspace', '--cwd', tmpDir], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.type, 'standalone');
    assert.strictEqual(parsed.signal, null);
  });

  test('includes submodule_paths field for submodule workspace', () => {
    fs.writeFileSync(path.join(tmpDir, '.gitmodules'),
      '[submodule "mylib"]\n\tpath = mylib\n\turl = https://example.com\n');
    const result = runGsdTools(['detect-workspace', '--cwd', tmpDir], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.type, 'submodule');
    assert.deepStrictEqual(parsed.submodule_paths, ['mylib']);
  });
});
