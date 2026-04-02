/**
 * GSD Tools Tests — Workspace Detection and Memory Helpers
 */

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { runGsdTools, createTempProject, createTempGitProject, cleanup, resolveTmpDir, createSubmoduleWorkspace, touchSubmodule } = require('./helpers.cjs');

// ─────────────────────────────────────────────────────────────────────────────
// detectWorkspaceType — workspace topology detection
// ─────────────────────────────────────────────────────────────────────────────

describe('detectWorkspaceType', () => {
  // Import directly for unit tests
  const workspace = require('../gsd-ng/bin/lib/workspace.cjs');
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
  const workspace = require('../gsd-ng/bin/lib/workspace.cjs');
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
  const workspace = require('../gsd-ng/bin/lib/workspace.cjs');
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
  const workspace = require('../gsd-ng/bin/lib/workspace.cjs');
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
  const workspace = require('../gsd-ng/bin/lib/workspace.cjs');
  const { cmdValidateHealth } = require('../gsd-ng/bin/lib/verify.cjs');
  const TEMPLATE_PATH = path.join(__dirname, '..', 'gsd-ng', 'templates', 'memory-templates', 'multi-boundary.md');
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
    const origOutput = require('../gsd-ng/bin/lib/core.cjs').output;

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

// ─────────────────────────────────────────────────────────────────────────────
// resolveGitContext / cmdGitContext — git context routing
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Helper: create a temp git repo with a remote.
 * Returns the temp dir path.
 */
function createTempGitRepo(remoteUrl) {
  const tmpDir = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-git-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config commit.gpgsign false', { cwd: tmpDir, stdio: 'pipe' });
  execSync(`git remote add origin "${remoteUrl}"`, { cwd: tmpDir, stdio: 'pipe' });
  // Create initial commit so branch exists
  fs.writeFileSync(path.join(tmpDir, 'README.md'), '# Test\n');
  execSync('git add README.md', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git commit -m "initial"', { cwd: tmpDir, stdio: 'pipe' });
  return tmpDir;
}

// createSubmoduleWorkspace and touchSubmodule are imported from ./helpers.cjs

describe('resolveGitContext', () => {
  const workspace = require('../gsd-ng/bin/lib/workspace.cjs');
  let tmpDir;

  afterEach(() => {
    if (tmpDir) cleanup(tmpDir);
    tmpDir = null;
  });

  test('Test 1: standalone workspace returns is_submodule=false, git_cwd=cwd, correct remote/branch', () => {
    tmpDir = createTempGitRepo('https://github.com/user/standalone.git');
    const result = workspace.resolveGitContext(tmpDir);

    assert.strictEqual(result.is_submodule, false, 'is_submodule should be false');
    assert.strictEqual(result.git_cwd, tmpDir, 'git_cwd should be cwd');
    assert.ok(result.remote, 'remote should be set');
    assert.ok(result.remote_url, 'remote_url should be set');
    assert.ok(result.current_branch, 'current_branch should be set');
    assert.ok(result.target_branch, 'target_branch should be set');
    assert.strictEqual(result.ssh_url, false, 'ssh_url should be false for https remote');
  });

  test('Test 2: submodule workspace with diff in submodule returns is_submodule=true, correct submodule_path', () => {
    const { workspaceDir, subDirs } = createSubmoduleWorkspace([
      { name: 'mylib', path: 'mylib', remoteUrl: 'https://github.com/user/mylib.git' },
    ]);
    tmpDir = workspaceDir;

    // Advance the submodule and update gitlink in workspace index (simulate submodule change)
    touchSubmodule(workspaceDir, 'mylib');

    const result = workspace.resolveGitContext(workspaceDir);

    assert.strictEqual(result.is_submodule, true, 'is_submodule should be true');
    assert.strictEqual(result.submodule_path, 'mylib', 'submodule_path should be mylib');
    assert.ok(result.git_cwd, 'git_cwd should be set');
    assert.ok(result.git_cwd.endsWith('mylib'), 'git_cwd should end with submodule path');
  });

  test('Test 3: submodule workspace with diff in one of multiple submodules returns correct active submodule', () => {
    const { workspaceDir, subDirs } = createSubmoduleWorkspace([
      { name: 'lib-a', path: 'lib-a', remoteUrl: 'https://github.com/user/lib-a.git' },
      { name: 'lib-b', path: 'lib-b', remoteUrl: 'https://github.com/user/lib-b.git' },
    ]);
    tmpDir = workspaceDir;

    // Only advance lib-b
    touchSubmodule(workspaceDir, 'lib-b');

    const result = workspace.resolveGitContext(workspaceDir);

    assert.strictEqual(result.is_submodule, true, 'is_submodule should be true');
    assert.strictEqual(result.submodule_path, 'lib-b', 'should resolve to lib-b (only one with diff)');
    assert.strictEqual(result.ambiguous, false, 'should not be ambiguous');
  });

  test('Test 4: submodule workspace with diffs in multiple submodules sets ambiguous=true', () => {
    const { workspaceDir, subDirs } = createSubmoduleWorkspace([
      { name: 'lib-a', path: 'lib-a', remoteUrl: 'https://github.com/user/lib-a.git' },
      { name: 'lib-b', path: 'lib-b', remoteUrl: 'https://github.com/user/lib-b.git' },
    ]);
    tmpDir = workspaceDir;

    // Advance both submodules
    touchSubmodule(workspaceDir, 'lib-a');
    touchSubmodule(workspaceDir, 'lib-b');

    const result = workspace.resolveGitContext(workspaceDir);

    assert.strictEqual(result.is_submodule, true, 'is_submodule should be true');
    assert.strictEqual(result.ambiguous, true, 'should be ambiguous');
    assert.ok(result.ambiguous_paths.includes('lib-a'), 'ambiguous_paths should include lib-a');
    assert.ok(result.ambiguous_paths.includes('lib-b'), 'ambiguous_paths should include lib-b');
  });

  test('Test 5: submodule workspace with no diff match but single submodule falls back to that submodule', () => {
    const { workspaceDir, subDirs } = createSubmoduleWorkspace([
      { name: 'mylib', path: 'mylib', remoteUrl: 'https://github.com/user/mylib.git' },
    ]);
    tmpDir = workspaceDir;
    // No staged changes — should fall back to the only submodule

    const result = workspace.resolveGitContext(workspaceDir);

    assert.strictEqual(result.is_submodule, true, 'is_submodule should be true');
    assert.strictEqual(result.submodule_path, 'mylib', 'should fall back to the only submodule');
    assert.strictEqual(result.ambiguous, false, 'should not be ambiguous');
  });

  test('Test 6: resolveGitContext reads git.submodules.NAME.target_branch from config as override', () => {
    const { workspaceDir, subDirs } = createSubmoduleWorkspace([
      { name: 'mylib', path: 'mylib', remoteUrl: 'https://github.com/user/mylib.git' },
    ]);
    tmpDir = workspaceDir;

    // Write config with per-submodule target_branch override (new git.submodules.NAME.* format)
    const configPath = path.join(workspaceDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      git: {
        submodules: {
          mylib: {
            target_branch: 'develop',
          },
        },
      },
    }, null, 2));

    touchSubmodule(workspaceDir, 'mylib');
    const result = workspace.resolveGitContext(workspaceDir);

    assert.strictEqual(result.is_submodule, true, 'is_submodule should be true');
    assert.strictEqual(result.target_branch, 'develop', 'target_branch should be from config override');
  });

  test('Test 7: resolveGitContext includes platform, cli, cli_installed fields for github remote', () => {
    tmpDir = createTempGitRepo('https://github.com/user/myrepo.git');
    const result = workspace.resolveGitContext(tmpDir);

    assert.ok('platform' in result, 'result should have platform field');
    assert.ok('cli' in result, 'result should have cli field');
    assert.ok('cli_installed' in result, 'result should have cli_installed field');
    assert.strictEqual(result.platform, 'github', 'platform should be github for github.com remote');
    assert.strictEqual(result.cli, 'gh', 'cli should be gh for github platform');
  });

  test('Test 8: ssh_url is true for git@ URL, false for https://', () => {
    // SSH URL
    const sshDir = createTempGitRepo('git@github.com:user/repo.git');
    try {
      const sshResult = workspace.resolveGitContext(sshDir);
      assert.strictEqual(sshResult.ssh_url, true, 'ssh_url should be true for git@ URL');
    } finally {
      cleanup(sshDir);
    }

    // HTTPS URL
    tmpDir = createTempGitRepo('https://github.com/user/repo.git');
    const httpsResult = workspace.resolveGitContext(tmpDir);
    assert.strictEqual(httpsResult.ssh_url, false, 'ssh_url should be false for https:// URL');
  });

  test('Test 9: multiple submodules with no diffs returns ambiguous=true', () => {
    const { workspaceDir } = createSubmoduleWorkspace([
      { name: 'lib-a', path: 'lib-a', remoteUrl: 'https://github.com/user/lib-a.git' },
      { name: 'lib-b', path: 'lib-b', remoteUrl: 'https://github.com/user/lib-b.git' },
    ]);
    tmpDir = workspaceDir;

    // Do NOT touch either submodule — no diffs
    const result = workspace.resolveGitContext(workspaceDir);

    assert.strictEqual(result.ambiguous, true, 'should be ambiguous when multiple submodules have no diffs');
    assert.strictEqual(result.ambiguous_paths.length, 2, 'should list both submodule paths');
    assert.ok(result.ambiguous_paths.includes('lib-a'), 'should include lib-a');
    assert.ok(result.ambiguous_paths.includes('lib-b'), 'should include lib-b');
    assert.strictEqual(result.submodule_path, null, 'should not pick a submodule');
    assert.strictEqual(result.git_cwd, null, 'should not resolve git_cwd');
  });

  test('Test 10: per-submodule config overrides global git.target_branch', () => {
    const { workspaceDir } = createSubmoduleWorkspace([
      { name: 'mylib', path: 'mylib', remoteUrl: 'https://github.com/user/mylib.git' },
    ]);
    tmpDir = workspaceDir;
    touchSubmodule(workspaceDir, 'mylib');
    const configPath = path.join(workspaceDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      git: {
        target_branch: 'global-branch',
        submodules: {
          mylib: { target_branch: 'per-submodule-branch' },
        },
      },
    }, null, 2));
    const result = workspace.resolveGitContext(workspaceDir);
    assert.strictEqual(result.target_branch, 'per-submodule-branch',
      'per-submodule target_branch should win over global');
  });

  test('Test 11: global git.target_branch used when no per-submodule override exists', () => {
    const { workspaceDir } = createSubmoduleWorkspace([
      { name: 'mylib', path: 'mylib', remoteUrl: 'https://github.com/user/mylib.git' },
    ]);
    tmpDir = workspaceDir;
    touchSubmodule(workspaceDir, 'mylib');
    const configPath = path.join(workspaceDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      git: { target_branch: 'staging' },
    }, null, 2));
    const result = workspace.resolveGitContext(workspaceDir);
    assert.strictEqual(result.target_branch, 'staging',
      'global target_branch should be used when no submodule override');
  });

  test('Test 12: per-submodule branching_strategy exposed in resolveGitContext result', () => {
    const { workspaceDir } = createSubmoduleWorkspace([
      { name: 'mylib', path: 'mylib', remoteUrl: 'https://github.com/user/mylib.git' },
    ]);
    tmpDir = workspaceDir;
    touchSubmodule(workspaceDir, 'mylib');
    const configPath = path.join(workspaceDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      git: {
        branching_strategy: 'none',
        submodules: {
          mylib: { branching_strategy: 'phase' },
        },
      },
    }, null, 2));
    const result = workspace.resolveGitContext(workspaceDir);
    assert.strictEqual(result.branching_strategy, 'phase',
      'branching_strategy should be per-submodule override value');
  });

  test('Test 13: resolveGitContext error path — non-git dir causes cmdInitExecutePhase to return submodule_is_active: false', () => {
    // resolveGitContext propagates throws (no internal try/catch).
    // The wrapping cmdInitExecutePhase has try/catch that returns defaults.
    // We test this via the CLI: a non-git cwd returns submodule_is_active: false.
    const nonGitDir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'gsd-nongit-'));
    fs.mkdirSync(path.join(nonGitDir, '.planning', 'phases'), { recursive: true });
    try {
      // For init execute-phase to not immediately error on "phase not found",
      // create a minimal phase dir and roadmap
      const phaseDir = path.join(nonGitDir, '.planning', 'phases', '01-test');
      fs.mkdirSync(phaseDir, { recursive: true });
      fs.writeFileSync(
        path.join(nonGitDir, '.planning', 'ROADMAP.md'),
        '# Roadmap\n\n## Phase Details\n\n### Phase 1: Test\n**Goal:** Test\n**Requirements:** none\n**Depends on:** nothing\n**Plans:** 1 plans\n\nPlans:\n- [ ] 01-01-PLAN.md\n'
      );
      fs.writeFileSync(
        path.join(nonGitDir, '.planning', 'STATE.md'),
        '---\ngsd_state_version: 1.0\nmilestone: test\ncurrent_phase: 1\ncurrent_plan: Not started\nstatus: testing\n---\n\n# Project State\n'
      );
      const result = runGsdTools(['init', 'execute-phase', '1'], nonGitDir);
      // The command should succeed (error caught internally)
      assert.ok(result.success, `init should succeed even for non-git dir: ${result.error}`);
      const parsed = JSON.parse(result.output);
      assert.strictEqual(parsed.submodule_is_active, false,
        'submodule_is_active should be false when git context resolution fails');
    } finally {
      fs.rmSync(nonGitDir, { recursive: true, force: true });
    }
  });

  test('Test 14: submodule with no remote configured returns remote_url: null', () => {
    const { workspaceDir, subDirs } = createSubmoduleWorkspace([
      { name: 'mylib', path: 'mylib', remoteUrl: 'https://github.com/user/mylib.git' },
    ]);
    tmpDir = workspaceDir;
    touchSubmodule(workspaceDir, 'mylib');
    // Remove the remote from the submodule dir
    execSync('git remote remove origin', { cwd: subDirs[0], stdio: 'pipe' });
    const result = workspace.resolveGitContext(workspaceDir);
    assert.strictEqual(result.remote_url, null,
      'remote_url should be null when no remote is configured');
  });

  test('Test 15: special characters in submodule path', () => {
    const { workspaceDir } = createSubmoduleWorkspace([
      { name: 'my-lib', path: 'my-lib', remoteUrl: 'https://github.com/user/my-lib.git' },
    ]);
    tmpDir = workspaceDir;
    touchSubmodule(workspaceDir, 'my-lib');
    // Should not throw
    let result;
    assert.doesNotThrow(() => {
      result = workspace.resolveGitContext(workspaceDir);
    }, 'resolveGitContext should not throw for submodule path with hyphens');
    assert.strictEqual(result.is_submodule, true, 'is_submodule should be true');
  });

  test('Test 16: per-submodule config for nonexistent submodule name is silently ignored', () => {
    const { workspaceDir } = createSubmoduleWorkspace([
      { name: 'mylib', path: 'mylib', remoteUrl: 'https://github.com/user/mylib.git' },
    ]);
    tmpDir = workspaceDir;
    touchSubmodule(workspaceDir, 'mylib');
    const configPath = path.join(workspaceDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      git: {
        target_branch: 'global-branch',
        submodules: {
          nonexistent: { target_branch: 'custom-branch' },
        },
      },
    }, null, 2));
    const result = workspace.resolveGitContext(workspaceDir);
    assert.notStrictEqual(result.target_branch, 'custom-branch',
      'nonexistent submodule config should not affect active submodule');
    assert.strictEqual(result.target_branch, 'global-branch',
      'global target_branch should be used when submodule name has no matching config');
  });

  test('Test 17: type_aliases merge in resolveGitContext return', () => {
    const { workspaceDir } = createSubmoduleWorkspace([
      { name: 'mylib', path: 'mylib', remoteUrl: 'https://github.com/user/mylib.git' },
    ]);
    tmpDir = workspaceDir;
    touchSubmodule(workspaceDir, 'mylib');
    const configPath = path.join(workspaceDir, '.planning', 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      git: {
        submodules: {
          mylib: { type_aliases: { feat: 'feature-custom' } },
        },
      },
    }, null, 2));
    const result = workspace.resolveGitContext(workspaceDir);
    assert.notStrictEqual(result.type_aliases, null,
      'type_aliases should not be null when set in per-submodule config');
    assert.strictEqual(result.type_aliases.feat, 'feature-custom',
      'type_aliases.feat should reflect per-submodule override');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// --field extraction — scalar extraction from git-context and detect-workspace
// ─────────────────────────────────────────────────────────────────────────────

describe('--field extraction on git-context and detect-workspace', () => {
  test('git-context --field is_submodule --raw returns scalar string', () => {
    const result = runGsdTools(['git-context', '--field', 'is_submodule', '--raw']);
    assert.ok(result.success, `should succeed: ${result.error}`);
    // Output should be "true" or "false", not JSON
    assert.ok(['true', 'false'].includes(result.output.trim()), `expected boolean string, got: ${result.output}`);
  });

  test('detect-workspace --field type --raw returns workspace type string', () => {
    const result = runGsdTools(['detect-workspace', '--field', 'type', '--raw']);
    assert.ok(result.success, `should succeed: ${result.error}`);
    assert.ok(['standalone', 'submodule'].includes(result.output.trim()), `expected type string, got: ${result.output}`);
  });

  test('detect-workspace --field type --raw returns no JSON braces', () => {
    const result = runGsdTools(['detect-workspace', '--field', 'type', '--raw']);
    assert.ok(result.success);
    assert.ok(!result.output.includes('{'), 'output should not contain JSON braces');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// ssh-check command — SSH agent status detection
// ─────────────────────────────────────────────────────────────────────────────

describe('ssh-check command', () => {
  test('ssh-check with HTTPS URL returns not_required', () => {
    const result = runGsdTools(['ssh-check', 'https://github.com/user/repo.git']);
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.ssh_required, false);
    assert.strictEqual(parsed.status, 'not_required');
  });

  test('ssh-check with SSH URL returns ssh_required=true', () => {
    const result = runGsdTools(['ssh-check', 'git@github.com:user/repo.git']);
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.ssh_required, true);
    assert.ok(['ok', 'no_identities', 'agent_not_running'].includes(parsed.status), `unexpected status: ${parsed.status}`);
  });

  test('ssh-check with --field status --raw returns scalar', () => {
    const result = runGsdTools(['ssh-check', 'https://github.com/user/repo.git', '--field', 'status', '--raw']);
    assert.ok(result.success, `should succeed: ${result.error}`);
    assert.strictEqual(result.output.trim(), 'not_required');
  });

  test('ssh-check with no URL returns not_required', () => {
    const result = runGsdTools(['ssh-check']);
    assert.ok(result.success, `should succeed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'not_required');
  });
});

describe('cmdGitContext CLI integration', () => {
  let tmpDir;

  afterEach(() => {
    if (tmpDir) cleanup(tmpDir);
    tmpDir = null;
  });

  test('Test 9: CLI git-context outputs valid JSON with expected top-level keys including platform, cli, ssh_url', () => {
    tmpDir = createTempGitRepo('https://github.com/user/myrepo.git');

    const result = runGsdTools(['git-context', '--cwd', tmpDir], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);

    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(result.output);
    }, 'output should be valid JSON');

    // Check all required top-level keys
    const requiredKeys = [
      'is_submodule', 'submodule_path', 'git_cwd', 'remote', 'remote_url',
      'ssh_url', 'target_branch', 'current_branch', 'ambiguous', 'ambiguous_paths',
      'platform', 'cli', 'cli_installed', 'cli_install_url',
    ];
    for (const key of requiredKeys) {
      assert.ok(key in parsed, `result should have key: ${key}`);
    }

    assert.strictEqual(parsed.is_submodule, false, 'standalone workspace is_submodule should be false');
    assert.strictEqual(parsed.platform, 'github', 'platform should be github');
    assert.strictEqual(parsed.cli, 'gh', 'cli should be gh');
    assert.ok(typeof parsed.ssh_url === 'boolean', 'ssh_url should be a boolean');
  });
});
