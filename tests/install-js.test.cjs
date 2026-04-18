'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTALLER = path.resolve(__dirname, '..', 'bin', 'install.js');

// Resolve a writable temp base — sandbox sets TMPDIR=/tmp/claude which may not exist on disk
const { resolveTmpDir, cleanup } = require('./helpers.cjs');
const BASE_TMPDIR = resolveTmpDir();

// ── TILDE-01: global install uses tilde paths, not absolute home dir ──────────

test('TILDE-01: install.js global install uses tilde paths in workflow files (no PII leak)', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-tilde-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--global', '--config-dir', path.join(tmpDir, '.claude')],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --global must exit 0 (TILDE-01)\nstderr: ' + (result.stderr || '')
    );

    const workflowsDir = path.join(tmpDir, '.claude', 'gsd-ng', 'workflows');
    const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md'));
    assert.ok(files.length > 0, 'workflows dir must contain .md files');

    // Global install must not bake absolute home dir paths (containing username) into files
    const homeDir = os.homedir();
    const badFiles = [];
    for (const fname of files) {
      const content = fs.readFileSync(path.join(workflowsDir, fname), 'utf8');
      // Check for raw absolute home path (not $HOME or ~) — this would be a PII leak
      if (content.includes(homeDir + '/')) {
        badFiles.push(fname);
      }
    }

    assert.ok(
      badFiles.length === 0,
      'install.js global install must not produce absolute home dir paths in workflow files (TILDE-01).\n' +
      'Offending files: ' + badFiles.join(', ') + '\n' +
      'Home dir: ' + homeDir
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── UNINSTALL-01: banner shows Mode: Uninstall in uninstall mode ──────────────

test('UNINSTALL-01: install.js --uninstall shows Mode: Uninstall indicator in output', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-uninstall-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--global', '--uninstall', '--config-dir', path.join(tmpDir, '.claude')],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    // Uninstall may exit 0 even if directory doesn't exist
    const output = result.stdout || '';
    assert.ok(
      output.includes('Mode: Uninstall'),
      'install.js --uninstall must show "Mode: Uninstall" in output (UNINSTALL-01).\n' +
      'Actual stdout: ' + output.slice(0, 500)
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PATH-03: local install produces $CLAUDE_PROJECT_DIR paths, not $HOME ──────

test('PATH-03: install.js local install uses $CLAUDE_PROJECT_DIR in workflow bash blocks', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-path-local-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    // Non-interactive: exit 0 expected
    assert.strictEqual(
      result.status,
      0,
      'install.js --local must exit 0 (PATH-03)\nstderr: ' + (result.stderr || '')
    );

    const workflowsDir = path.join(tmpDir, '.claude', 'gsd-ng', 'workflows');
    const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md'));
    assert.ok(files.length > 0, 'workflows dir must contain .md files');

    let badPathFound = false;
    let goodPathFound = false;
    const badFiles = [];
    for (const fname of files) {
      const content = fs.readFileSync(path.join(workflowsDir, fname), 'utf8');
      // Must NOT contain raw $HOME/.claude/ or ~/.claude/ in installed files
      if (content.includes('$HOME/.claude/') || content.includes('~/.claude/')) {
        badPathFound = true;
        badFiles.push(fname);
      }
      // Must produce fallback chain path in at least one file
      // New pattern: "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/"
      if (content.includes('${CLAUDE_PROJECT_DIR:-$(git rev-parse')) {
        goodPathFound = true;
      }
    }

    assert.ok(
      !badPathFound,
      'install.js local install must not produce $HOME/.claude/ or ~/.claude/ in workflow files (PATH-03).\n' +
      'Offending files: ' + badFiles.join(', ')
    );
    assert.ok(
      goodPathFound,
      'install.js local install must produce fallback chain ${CLAUDE_PROJECT_DIR:-$(git rev-parse...)}/.claude/ in workflow files (PATH-03)'
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PATH-04: local install must not produce ./.claude/ relative paths ─────────

test('PATH-04: install.js local install must not produce ./.claude/ paths in bash code blocks', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-no-rel-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(result.status, 0, 'install.js --local must exit 0');

    const workflowsDir = path.join(tmpDir, '.claude', 'gsd-ng', 'workflows');
    const files = fs.readdirSync(workflowsDir).filter(f => f.endsWith('.md'));

    // Look specifically for ./.claude/ in bash code blocks (the regression pattern)
    // The pattern node "./.claude/ is what broke before the fix
    const relativePathPattern = /node\s+"\.\/\.claude\//;
    const badFiles = [];
    for (const fname of files) {
      const content = fs.readFileSync(path.join(workflowsDir, fname), 'utf8');
      if (relativePathPattern.test(content)) {
        badFiles.push(fname);
      }
    }

    assert.ok(
      badFiles.length === 0,
      'install.js local install must not produce node "./.claude/ references in workflow files (PATH-04).\n' +
      'Offending files: ' + badFiles.join(', ')
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-06: settings-sandbox.json template contains Agent(*), bare Edit, bare Write, bare Read ──

test('PERM-06: settings-sandbox.json template contains Agent(*), bare Edit/Write/Read, no deny rules, subshell builtins', () => {
  const templatePath = path.resolve(__dirname, '..', 'gsd-ng', 'templates', 'settings-sandbox.json');
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const allow = template.permissions.allow;
  assert.ok(allow.includes('Agent(*)'), 'template must include Agent(*)');
  assert.ok(allow.includes('Edit'), 'template must include bare Edit (not Edit(*)) for Linux bubblewrap compatibility');
  assert.ok(allow.includes('Write'), 'template must include bare Write (not Write(*)) for Linux bubblewrap compatibility');
  assert.ok(allow.includes('Read'), 'template must include bare Read for Linux bubblewrap compatibility');
  assert.ok(allow.indexOf('Edit(*)') === -1, 'template must NOT include Edit(*) -- use bare Edit instead');
  assert.ok(allow.indexOf('Write(*)') === -1, 'template must NOT include Write(*) -- use bare Write instead');
  // Deny rules dropped per Phase 52 -- GSD-NG ships allow rules only
  assert.strictEqual(template.permissions.deny, undefined, 'template must NOT have permissions.deny section (deny rules dropped in Phase 52)');

  // Verify new subshell builtins were added (Bug 9 fix)
  assert.ok(allow.includes('Bash(basename *)'), 'template must include Bash(basename *)');
  assert.ok(allow.includes('Bash(dirname *)'), 'template must include Bash(dirname *)');
  assert.ok(allow.includes('Bash(cut *)'), 'template must include Bash(cut *)');
  assert.ok(allow.includes('Bash(tee *)'), 'template must include Bash(tee *)');
  assert.ok(allow.includes('Bash(uniq *)'), 'template must include Bash(uniq *)');
  assert.ok(allow.includes('Bash(seq *)'), 'template must include Bash(seq *)');
});

// ── PERM-07: install seeds granular platform CLI patterns, not blanket wildcards ──

test('PERM-07: local install seeds granular gh subcommand patterns (not blanket Bash(gh *))', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-perm07-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(result.status, 0, 'install must exit 0 (PERM-07)\nstderr: ' + (result.stderr || ''));

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const allow = settings.permissions.allow;

    // gh is typically installed in CI/dev environments
    // If gh is installed, we should see granular patterns
    try {
      require('child_process').execSync('which gh', { stdio: 'ignore', timeout: 2000 });
      // gh is installed -- verify granular patterns
      assert.ok(allow.includes('Bash(gh pr *)'), 'must include Bash(gh pr *) when gh is installed (PERM-07)');
      assert.ok(allow.includes('Bash(gh pr)'), 'must include Bash(gh pr) when gh is installed (PERM-07)');
      assert.ok(allow.includes('Bash(gh issue *)'), 'must include Bash(gh issue *) when gh is installed (PERM-07)');
      assert.ok(!allow.includes('Bash(gh *)'), 'must NOT include blanket Bash(gh *) (PERM-07)');
      assert.ok(!allow.includes('Bash(gh api *)'), 'must NOT include Bash(gh api *) (PERM-07)');
      assert.ok(!allow.includes('Bash(gh extension *)'), 'must NOT include Bash(gh extension *) (PERM-07)');
    } catch {
      // gh not installed -- just verify no blanket pattern leaked
      assert.ok(!allow.includes('Bash(gh *)'), 'must NOT include blanket Bash(gh *) even without gh installed (PERM-07)');
    }
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-01: local install seeds permissions.allow with template entries ──────

test('PERM-01: local install seeds permissions.allow with template entries (Bash(node *) and Agent(*))', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-perm01-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(result.status, 0, 'install.js --local must exit 0 (PERM-01)\nstderr: ' + (result.stderr || ''));

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(Array.isArray(settings.permissions.allow), 'settings.permissions.allow must be an array (PERM-01)');
    assert.ok(settings.permissions.allow.includes('Bash(node *)'), 'permissions.allow must include Bash(node *) (PERM-01)');
    assert.ok(settings.permissions.allow.includes('Agent(*)'), 'permissions.allow must include Agent(*) (PERM-01)');
    // Sandbox is default-on: verify sandbox settings are seeded by default (PERM-01 default-on check)
    assert.strictEqual(settings.sandbox && settings.sandbox.enabled, true, 'sandbox.enabled must be true by default (PERM-01)');
    assert.strictEqual(settings.sandbox && settings.sandbox.autoAllowBashIfSandboxed, true, 'sandbox.autoAllowBashIfSandboxed must be true by default (PERM-01)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-02: running --local install twice produces no duplicate entries ──────

test('PERM-02: running --local install twice produces no duplicate entries in permissions.allow', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-perm02-'));
  try {
    const runInstall = () => spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    const r1 = runInstall();
    assert.strictEqual(r1.status, 0, 'first install must exit 0 (PERM-02)\nstderr: ' + (r1.stderr || ''));
    const r2 = runInstall();
    assert.strictEqual(r2.status, 0, 'second install must exit 0 (PERM-02)\nstderr: ' + (r2.stderr || ''));

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const allow = settings.permissions.allow;

    const agentCount = allow.filter(e => e === 'Agent(*)').length;
    assert.strictEqual(agentCount, 1, 'Agent(*) must appear exactly once after two installs (PERM-02)');

    // Verify idempotency: no duplicate entries after two installs
    // (length may exceed template length when platform CLIs like gh are installed)
    const uniqueEntries = new Set(allow);
    assert.strictEqual(uniqueEntries.size, allow.length, 'permissions.allow must have no duplicate entries after two installs (PERM-02)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-03: --no-seed-permissions-config does NOT create permissions.allow ───

test('PERM-03: --local --no-seed-permissions-config does not create permissions.allow in settings.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-perm03-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local', '--no-seed-permissions-config'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(result.status, 0, 'install.js --local --no-seed-permissions-config must exit 0 (PERM-03)\nstderr: ' + (result.stderr || ''));

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hasAllow = settings.permissions !== undefined && settings.permissions.allow !== undefined;
    assert.ok(!hasAllow, 'permissions.allow must not exist when --no-seed-permissions-config is used (PERM-03)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-04: --no-seed-sandbox-config suppresses sandbox settings seeding ────

test('PERM-04: --local --no-seed-sandbox-config suppresses sandbox settings seeding', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-perm04-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local', '--no-seed-sandbox-config'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(result.status, 0, 'install.js --local --no-seed-sandbox-config must exit 0 (PERM-04)\nstderr: ' + (result.stderr || ''));

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    // Sandbox seeding should be suppressed when --no-seed-sandbox-config is used
    const sandboxEnabled = settings.sandbox !== undefined && settings.sandbox.enabled !== undefined;
    assert.ok(!sandboxEnabled, 'sandbox.enabled must not be set when --no-seed-sandbox-config is used (PERM-04)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-05: uninstall removes template entries but preserves custom entries ──

test('PERM-05: uninstall removes template-sourced entries from permissions.allow but preserves custom user entries', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-perm05-'));
  try {
    // First install
    const installResult = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(installResult.status, 0, 'initial install must exit 0 (PERM-05)\nstderr: ' + (installResult.stderr || ''));

    // Add a custom entry
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    settings.permissions.allow.push('Bash(my-custom-tool *)');
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    // Uninstall
    const uninstallResult = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local', '--uninstall'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(uninstallResult.status, 0, 'uninstall must exit 0 (PERM-05)\nstderr: ' + (uninstallResult.stderr || ''));

    // Check settings after uninstall
    const settingsAfter = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const allowAfter = settingsAfter.permissions.allow;
    assert.ok(allowAfter.includes('Bash(my-custom-tool *)'), 'custom entry must be preserved after uninstall (PERM-05)');
    assert.ok(!allowAfter.includes('Agent(*)'), 'Agent(*) must be removed after uninstall (PERM-05)');
    assert.ok(!allowAfter.includes('Bash(node *)'), 'Bash(node *) must be removed after uninstall (PERM-05)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── SAND-01: --no-seed-sandbox-config still seeds permissions.allow ───────────

test('SAND-01: --local --no-seed-sandbox-config still seeds permissions.allow', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-sand01-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local', '--no-seed-sandbox-config'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(result.status, 0, 'install.js --local --no-seed-sandbox-config must exit 0 (SAND-01)\nstderr: ' + (result.stderr || ''));

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Permissions should still be seeded even when sandbox config is suppressed
    assert.ok(Array.isArray(settings.permissions && settings.permissions.allow), 'permissions.allow must be seeded even when --no-seed-sandbox-config is used (SAND-01)');
    assert.ok(settings.permissions.allow.includes('Bash(node *)'), 'permissions.allow must include Bash(node *) (SAND-01)');
    assert.ok(settings.permissions.allow.includes('Agent(*)'), 'permissions.allow must include Agent(*) (SAND-01)');

    // Sandbox settings must NOT be seeded
    const sandboxEnabled = settings.sandbox !== undefined && settings.sandbox.enabled !== undefined;
    assert.ok(!sandboxEnabled, 'sandbox.enabled must not be set when --no-seed-sandbox-config is used (SAND-01)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── RUNTIME-01: --local without --runtime exits non-zero ──────────────────────

test('RUNTIME-01: --local without --runtime exits non-zero with helpful error', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-rt01-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.notStrictEqual(result.status, 0, '--local without --runtime must exit non-zero (RUNTIME-01)');
    const output = (result.stderr || '') + (result.stdout || '');
    assert.ok(
      output.includes('Error: --runtime required'),
      'must show "Error: --runtime required" message (RUNTIME-01)\nActual output: ' + output.slice(0, 500)
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── RUNTIME-02: --global without --runtime exits non-zero ─────────────────────

test('RUNTIME-02: --global without --runtime exits non-zero with helpful error', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-rt02-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--global', '--config-dir', path.join(tmpDir, '.claude')],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.notStrictEqual(result.status, 0, '--global without --runtime must exit non-zero (RUNTIME-02)');
    const output = (result.stderr || '') + (result.stdout || '');
    assert.ok(
      output.includes('Error: --runtime required'),
      'must show "Error: --runtime required" message (RUNTIME-02)\nActual output: ' + output.slice(0, 500)
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── RUNTIME-03: --uninstall without --runtime exits non-zero ──────────────────

test('RUNTIME-03: --uninstall --local without --runtime exits non-zero', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-rt03-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--local', '--uninstall'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.notStrictEqual(result.status, 0, '--uninstall without --runtime must exit non-zero (RUNTIME-03)');
    const output = (result.stderr || '') + (result.stdout || '');
    assert.ok(
      output.includes('Error: --runtime required'),
      'must show "Error: --runtime required" message (RUNTIME-03)\nActual output: ' + output.slice(0, 500)
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-01: --local --copilot creates skills/gsd-*/SKILL.md ──────────────

test('COPILOT-01: --local --copilot creates skills/gsd-*/SKILL.md from commands', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-01)\nstderr: ' + (result.stderr || '')
    );

    const skillsDir = path.join(tmpDir, '.github', 'skills');
    assert.ok(fs.existsSync(skillsDir), '.github/skills/ directory must exist (COPILOT-01)');

    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('gsd-'));
    assert.ok(skillDirs.length > 0, 'at least one gsd-* subdirectory must exist under skills/ (COPILOT-01)');

    for (const skillDir of skillDirs) {
      const skillMd = path.join(skillsDir, skillDir.name, 'SKILL.md');
      assert.ok(
        fs.existsSync(skillMd),
        `skills/${skillDir.name}/SKILL.md must exist (COPILOT-01)`
      );
    }
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-02: --local --copilot creates agents/gsd-*.agent.md ──────────────

test('COPILOT-02: --local --copilot creates agents/gsd-*.agent.md files', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-02)\nstderr: ' + (result.stderr || '')
    );

    const agentsDir = path.join(tmpDir, '.github', 'agents');
    assert.ok(fs.existsSync(agentsDir), '.github/agents/ directory must exist (COPILOT-02)');

    const agentFiles = fs.readdirSync(agentsDir)
      .filter(f => f.startsWith('gsd-') && f.endsWith('.agent.md'));
    assert.ok(agentFiles.length > 0, 'at least one gsd-*.agent.md file must exist (COPILOT-02)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-03: --local --copilot generates copilot-instructions.md ───────────

test('COPILOT-03: --local --copilot generates copilot-instructions.md with GSD markers', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-03)\nstderr: ' + (result.stderr || '')
    );

    const instructionsPath = path.join(tmpDir, '.github', 'copilot-instructions.md');
    assert.ok(fs.existsSync(instructionsPath), '.github/copilot-instructions.md must exist (COPILOT-03)');

    const content = fs.readFileSync(instructionsPath, 'utf8');
    assert.ok(
      content.includes('<!-- GSD Configuration'),
      'copilot-instructions.md must contain GSD open marker (COPILOT-03)'
    );
    assert.ok(
      content.includes('<!-- /GSD Configuration -->'),
      'copilot-instructions.md must contain GSD close marker (COPILOT-03)'
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-04: --local --copilot does NOT create settings.json ───────────────

test('COPILOT-04: --local --copilot does NOT create settings.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-04)\nstderr: ' + (result.stderr || '')
    );

    const settingsPath = path.join(tmpDir, '.github', 'settings.json');
    assert.ok(
      !fs.existsSync(settingsPath),
      '.github/settings.json must NOT exist for Copilot install (COPILOT-04)'
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-05: --local --copilot does NOT seed permissions or sandbox ────────

test('COPILOT-05: --local --copilot does NOT seed permissions or sandbox settings', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-05)\nstderr: ' + (result.stderr || '')
    );

    const githubDir = path.join(tmpDir, '.github');

    // No settings.json anywhere in .github/
    const settingsPath = path.join(githubDir, 'settings.json');
    assert.ok(
      !fs.existsSync(settingsPath),
      'No settings.json must exist in .github/ for Copilot install (COPILOT-05)'
    );

    // Walk .github/ recursively — no file should contain "permissions" key
    function walkDir(dir) {
      if (!fs.existsSync(dir)) return [];
      const results = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...walkDir(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.json')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const jsonFiles = walkDir(githubDir);
    for (const jsonFile of jsonFiles) {
      try {
        const data = JSON.parse(fs.readFileSync(jsonFile, 'utf8'));
        assert.ok(
          data.permissions === undefined,
          `${jsonFile} must not contain "permissions" key in Copilot install (COPILOT-05)`
        );
      } catch {
        // JSON parse error — skip
      }
    }
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-06: --local --copilot --uninstall removes GSD artifacts ───────────

test('COPILOT-06: --local --copilot --uninstall removes GSD skills, agents, and cleans copilot-instructions.md', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-copilot-'));
  try {
    // First: install
    const installResult = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(
      installResult.status,
      0,
      'install must exit 0 (COPILOT-06)\nstderr: ' + (installResult.stderr || '')
    );

    // Then: uninstall
    const uninstallResult = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local', '--uninstall'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(
      uninstallResult.status,
      0,
      'uninstall must exit 0 (COPILOT-06)\nstderr: ' + (uninstallResult.stderr || '')
    );

    const githubDir = path.join(tmpDir, '.github');

    // No gsd-* directories under skills/
    const skillsDir = path.join(githubDir, 'skills');
    if (fs.existsSync(skillsDir)) {
      const remainingSkills = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(e => e.isDirectory() && e.name.startsWith('gsd-'));
      assert.strictEqual(remainingSkills.length, 0, 'no gsd-* skill directories should remain after uninstall (COPILOT-06)');
    }

    // No gsd-*.agent.md files under agents/
    const agentsDir = path.join(githubDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      const remainingAgents = fs.readdirSync(agentsDir)
        .filter(f => f.startsWith('gsd-') && f.endsWith('.agent.md'));
      assert.strictEqual(remainingAgents.length, 0, 'no gsd-*.agent.md files should remain after uninstall (COPILOT-06)');
    }

    // copilot-instructions.md either deleted or stripped of GSD markers
    const instructionsPath = path.join(githubDir, 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      const content = fs.readFileSync(instructionsPath, 'utf8');
      assert.ok(
        !content.includes('<!-- GSD Configuration'),
        'copilot-instructions.md must not contain GSD markers after uninstall (COPILOT-06)'
      );
    }

    // gsd-ng/ directory removed
    const gsdNgDir = path.join(githubDir, 'gsd-ng');
    assert.ok(!fs.existsSync(gsdNgDir), 'gsd-ng/ directory must be removed after uninstall (COPILOT-06)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-07: no leaked ~/.claude/ paths in Copilot installed content ───────

test('COPILOT-07: --local --copilot installed files contain no ~/.claude/ or .claude/ path references', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-07)\nstderr: ' + (result.stderr || '')
    );

    // Walk all .md files recursively under .github/
    function walkMdFiles(dir) {
      if (!fs.existsSync(dir)) return [];
      const results = [];
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...walkMdFiles(fullPath));
        } else if (entry.isFile() && entry.name.endsWith('.md')) {
          results.push(fullPath);
        }
      }
      return results;
    }

    const githubDir = path.join(tmpDir, '.github');
    const mdFiles = walkMdFiles(githubDir);
    assert.ok(mdFiles.length > 0, 'must have installed .md files to check (COPILOT-07)');

    const badFiles = [];
    for (const mdFile of mdFiles) {
      const content = fs.readFileSync(mdFile, 'utf8');
      // Check for raw ~/.claude/ paths (not .github/ or .copilot/ which are correct)
      if (content.includes('~/.claude/') || content.includes('$HOME/.claude/') || content.includes('./.claude/')) {
        badFiles.push(path.relative(tmpDir, mdFile));
      }
    }

    assert.ok(
      badFiles.length === 0,
      'installed Copilot files must not contain ~/.claude/ or .claude/ paths (COPILOT-07).\n' +
      'Offending files: ' + badFiles.join(', ')
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-08: --runtime copilot flag works for non-interactive install ──────

test('COPILOT-08: --local --runtime copilot selects Copilot runtime', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR,'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--local', '--runtime', 'copilot'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --local --runtime copilot must exit 0 (COPILOT-08)\nstderr: ' + (result.stderr || '')
    );

    // .github/ directory must exist (Copilot runtime selected)
    const githubDir = path.join(tmpDir, '.github');
    assert.ok(fs.existsSync(githubDir), '.github/ directory must exist when --runtime copilot is used (COPILOT-08)');

    // skills/ directory must exist under .github/
    const skillsDir = path.join(githubDir, 'skills');
    assert.ok(fs.existsSync(skillsDir), '.github/skills/ directory must exist (COPILOT-08)');

    // .claude/ directory must NOT exist (wrong runtime)
    const claudeDir = path.join(tmpDir, '.claude');
    assert.ok(!fs.existsSync(claudeDir), '.claude/ directory must NOT exist when --runtime copilot is used (COPILOT-08)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-09: hooks/gsd-hooks.json written on Copilot local install ─────────

test('COPILOT-09: --local --runtime copilot writes hooks/gsd-hooks.json with sessionStart hook', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-cop09-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--local', '--runtime', 'copilot'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(result.status, 0, 'install must exit 0 (COPILOT-09)\nstderr: ' + (result.stderr || ''));

    const hooksFile = path.join(tmpDir, '.github', 'hooks', 'gsd-hooks.json');
    assert.ok(fs.existsSync(hooksFile), '.github/hooks/gsd-hooks.json must exist after Copilot install (COPILOT-09)');

    const content = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    assert.strictEqual(content.version, 1, 'hooks file must have version: 1 (COPILOT-09)');
    assert.ok(Array.isArray(content.hooks.sessionStart), 'hooks.sessionStart must be an array (COPILOT-09)');
    assert.ok(content.hooks.sessionStart.length > 0, 'sessionStart must have at least one hook entry (COPILOT-09)');
    assert.ok(
      content.hooks.sessionStart[0].bash.includes('gsd-check-update'),
      'sessionStart hook bash command must reference gsd-check-update (COPILOT-09)'
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── BASH-HOOK-01: claude local install creates bash-safety-hook.cjs in hooks dir ──

test('BASH-HOOK-01: claude local install creates bash-safety-hook.cjs in hooks directory', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-bh-01-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      { encoding: 'utf8', timeout: 15000, cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }) }
    );
    assert.strictEqual(result.status, 0,
      'install.js --runtime claude --local must exit 0 (BASH-HOOK-01)\nstderr: ' + (result.stderr || ''));
    const hookPath = path.join(tmpDir, '.claude', 'hooks', 'bash-safety-hook.cjs');
    assert.ok(fs.existsSync(hookPath),
      'hooks/bash-safety-hook.cjs must exist after claude local install (BASH-HOOK-01)');
    const content = fs.readFileSync(hookPath, 'utf8');
    assert.ok(content.startsWith('#!/usr/bin/env node'),
      'bash-safety-hook.cjs must start with #!/usr/bin/env node shebang (BASH-HOOK-01)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── BASH-HOOK-02: claude local install wires bash-safety-hook into settings.json ──

test('BASH-HOOK-02: claude local install wires bash-safety-hook into settings.json PreToolUse', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-bh-02-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      { encoding: 'utf8', timeout: 15000, cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }) }
    );
    assert.strictEqual(result.status, 0,
      'install.js --runtime claude --local must exit 0 (BASH-HOOK-02)\nstderr: ' + (result.stderr || ''));
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    assert.ok(fs.existsSync(settingsPath),
      'settings.json must exist after claude local install (BASH-HOOK-02)');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const preToolUse = settings.hooks && settings.hooks.PreToolUse;
    assert.ok(Array.isArray(preToolUse),
      'settings.json must have hooks.PreToolUse array (BASH-HOOK-02)');
    const bashSafetyEntry = preToolUse.find(entry =>
      entry.hooks && entry.hooks.some(h => h.command && h.command.includes('bash-safety-hook.cjs'))
    );
    assert.ok(bashSafetyEntry !== undefined,
      'settings.json PreToolUse must contain an entry with bash-safety-hook.cjs (BASH-HOOK-02)');
    assert.strictEqual(bashSafetyEntry.matcher, 'Bash',
      'bash-safety-hook entry must have matcher: "Bash" (BASH-HOOK-02)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── BASH-HOOK-03: idempotent — re-running does not duplicate hook in PreToolUse ──

test('BASH-HOOK-03: idempotent — re-running install does not duplicate bash-safety-hook in PreToolUse', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-bh-03-'));
  try {
    const runInstall = () => spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      { encoding: 'utf8', timeout: 15000, cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }) }
    );
    const r1 = runInstall();
    assert.strictEqual(r1.status, 0, 'First install must exit 0 (BASH-HOOK-03)');
    const r2 = runInstall();
    assert.strictEqual(r2.status, 0, 'Second install must exit 0 (BASH-HOOK-03)');
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const preToolUse = settings.hooks && settings.hooks.PreToolUse;
    const bashSafetyEntries = (preToolUse || []).filter(entry =>
      entry.hooks && entry.hooks.some(h => h.command && h.command.includes('bash-safety-hook.cjs'))
    );
    assert.strictEqual(bashSafetyEntries.length, 1,
      'bash-safety-hook.cjs must appear exactly once in PreToolUse after two installs (BASH-HOOK-03). ' +
      'Found: ' + bashSafetyEntries.length + ' entries');
  } finally {
    cleanup(tmpDir);
  }
});

// ── BASH-HOOK-04: copilot install does NOT wire bash-safety-hook into settings.json ──

test('BASH-HOOK-04: copilot local install does NOT wire bash-safety-hook into settings.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-bh-04-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      { encoding: 'utf8', timeout: 15000, cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }) }
    );
    assert.strictEqual(result.status, 0,
      'install.js --runtime copilot --local must exit 0 (BASH-HOOK-04)\nstderr: ' + (result.stderr || ''));
    const settingsPath = path.join(tmpDir, '.github', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const preToolUse = (settings.hooks && settings.hooks.PreToolUse) || [];
      const hasBashSafety = preToolUse.some(entry =>
        entry.hooks && entry.hooks.some(h => h.command && h.command.includes('bash-safety-hook.cjs'))
      );
      assert.ok(!hasBashSafety,
        'copilot settings.json must NOT contain bash-safety-hook.cjs in PreToolUse (BASH-HOOK-04)');
    }
    // Guardrail: hook file must not exist in Copilot target (future runtime safety)
    const hookFilePath = path.join(tmpDir, '.github', 'hooks', 'bash-safety-hook.cjs');
    assert.ok(!fs.existsSync(hookFilePath),
      'bash-safety-hook.cjs must NOT exist in Copilot hooks dir (BASH-HOOK-04)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── BASH-HOOK-05: anti-heredoc instruction present in agent-shared-context.md ──

test('BASH-HOOK-05: anti-heredoc instruction present in agent-shared-context.md after claude install', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-bh-05-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      { encoding: 'utf8', timeout: 15000, cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }) }
    );
    assert.strictEqual(result.status, 0,
      'install.js --runtime claude --local must exit 0 (BASH-HOOK-05)\nstderr: ' + (result.stderr || ''));
    const agentCtxPath = path.join(tmpDir, '.claude', 'gsd-ng', 'references', 'agent-shared-context.md');
    assert.ok(fs.existsSync(agentCtxPath),
      'agent-shared-context.md must exist after claude local install (BASH-HOOK-05)');
    const content = fs.readFileSync(agentCtxPath, 'utf8');
    assert.ok(content.includes('ALWAYS use the Write tool'),
      'agent-shared-context.md must contain anti-heredoc instruction (BASH-HOOK-05)');
    assert.ok(!content.includes('GSD — AST Safety Rules'),
      'agent-shared-context.md must NOT contain AST Safety Rules markers (BASH-HOOK-05)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── BASH-HOOK-06: copilot install ALSO has anti-heredoc in agent-shared-context.md ──

test('BASH-HOOK-06: copilot local install ALSO has anti-heredoc instruction in agent-shared-context.md', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-bh-06-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      { encoding: 'utf8', timeout: 15000, cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }) }
    );
    assert.strictEqual(result.status, 0,
      'install.js --runtime copilot --local must exit 0 (BASH-HOOK-06)\nstderr: ' + (result.stderr || ''));
    const agentCtxPath = path.join(tmpDir, '.github', 'gsd-ng', 'references', 'agent-shared-context.md');
    assert.ok(fs.existsSync(agentCtxPath),
      'agent-shared-context.md must exist after copilot local install (BASH-HOOK-06)');
    const content = fs.readFileSync(agentCtxPath, 'utf8');
    assert.ok(content.includes('ALWAYS use the Write tool'),
      'agent-shared-context.md must contain anti-heredoc instruction for copilot runtime too (BASH-HOOK-06)');
  } finally {
    cleanup(tmpDir);
  }
});

// ── BASH-HOOK-07: anti-heredoc not duplicated on re-install ──────────────────

test('BASH-HOOK-07: anti-heredoc not duplicated on re-install of claude local', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-bh-07-'));
  try {
    const runInstall = () => spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      { encoding: 'utf8', timeout: 15000, cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }) }
    );
    assert.strictEqual(runInstall().status, 0, 'First install must exit 0 (BASH-HOOK-07)');
    assert.strictEqual(runInstall().status, 0, 'Second install must exit 0 (BASH-HOOK-07)');
    const agentCtxPath = path.join(tmpDir, '.claude', 'gsd-ng', 'references', 'agent-shared-context.md');
    const content = fs.readFileSync(agentCtxPath, 'utf8');
    const occurrences = (content.match(/ALWAYS use the Write tool/g) || []).length;
    assert.strictEqual(occurrences, 1,
      '"ALWAYS use the Write tool" must appear exactly once after two installs (BASH-HOOK-07). Found: ' + occurrences);
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-10: SKILL.md name: fields must not contain colon character ────────

test('COPILOT-10: all SKILL.md name: fields must use gsd- prefix, not gsd: (no colons)', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-cop10-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--local', '--runtime', 'copilot'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(result.status, 0, 'install must exit 0 (COPILOT-10)\nstderr: ' + (result.stderr || ''));

    const skillsDir = path.join(tmpDir, '.github', 'skills');
    assert.ok(fs.existsSync(skillsDir), '.github/skills/ must exist (COPILOT-10)');

    const skillDirs = fs.readdirSync(skillsDir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.startsWith('gsd-'));
    assert.ok(skillDirs.length > 0, 'at least one gsd-* skill dir must exist (COPILOT-10)');

    const offending = [];
    for (const skillDir of skillDirs) {
      const skillMd = path.join(skillsDir, skillDir.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      const content = fs.readFileSync(skillMd, 'utf8');
      // Extract name: line from frontmatter
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      if (nameMatch && nameMatch[1].includes(':')) {
        offending.push(`${skillDir.name}/SKILL.md → name: ${nameMatch[1].trim()}`);
      }
    }

    assert.strictEqual(
      offending.length,
      0,
      'SKILL.md name: fields must not contain colons (COPILOT-10).\n' +
      'Offending files:\n' + offending.map(s => '  ' + s).join('\n')
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── SVN-01: copilot install writes snapshot VERSION (not verbatim copy) ───────

test('SVN-01: --runtime copilot --local writes .github/gsd-ng/VERSION with resolved version', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-svn-01-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (SVN-01)\nstderr: ' + (result.stderr || '')
    );

    const versionPath = path.join(tmpDir, '.github', 'gsd-ng', 'VERSION');
    assert.ok(fs.existsSync(versionPath), '.github/gsd-ng/VERSION must exist after copilot install (SVN-01)');

    const versionContent = fs.readFileSync(versionPath, 'utf8').trim();
    const pkg = require('../package.json');
    // Accept both clean version (tagged release) and snapshot version+hash (dev checkout).
    const snapshotRegex = new RegExp('^' + pkg.version.replace(/[.+]/g, '\\$&') + '(\\+[0-9a-f]{7,})?$');
    assert.ok(
      snapshotRegex.test(versionContent),
      'copilot VERSION must match ' + snapshotRegex + ' (SVN-01). Got: ' + JSON.stringify(versionContent)
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── SVN-02: banner output prints resolved (snapshot-aware) version ────────────

test('SVN-02: --runtime claude --local banner prints resolved version matching VERSION file', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-svn-02-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime claude --local must exit 0 (SVN-02)\nstderr: ' + (result.stderr || '')
    );

    const versionPath = path.join(tmpDir, '.claude', 'gsd-ng', 'VERSION');
    assert.ok(fs.existsSync(versionPath), '.claude/gsd-ng/VERSION must exist (SVN-02)');
    const versionContent = fs.readFileSync(versionPath, 'utf8').trim();

    // Banner line format: "  gsd-ng \x1b[2mv<version>\x1b[0m\n"
    // Strip ANSI and check the banner contains "gsd-ng v<versionContent>".
    const stdout = result.stdout || '';
    // Remove ANSI escape sequences for readable matching.
    const clean = stdout.replace(/\x1b\[[0-9;]*m/g, '');
    const expectedBannerFragment = 'gsd-ng v' + versionContent;
    assert.ok(
      clean.includes(expectedBannerFragment),
      'Banner must contain "' + expectedBannerFragment + '" matching VERSION file (SVN-02).\n' +
      'Stdout (ANSI-stripped, first 500 chars): ' + clean.slice(0, 500)
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── SVN-03: manifest.version matches VERSION file byte-for-byte ───────────────

test('SVN-03: --runtime claude --local writes manifest.version equal to VERSION file contents', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-svn-03-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      }
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime claude --local must exit 0 (SVN-03)\nstderr: ' + (result.stderr || '')
    );

    const versionPath = path.join(tmpDir, '.claude', 'gsd-ng', 'VERSION');
    const manifestPath = path.join(tmpDir, '.claude', 'gsd-file-manifest.json');
    assert.ok(fs.existsSync(versionPath), 'VERSION must exist (SVN-03)');
    assert.ok(fs.existsSync(manifestPath), 'gsd-file-manifest.json must exist (SVN-03)');

    const versionContent = fs.readFileSync(versionPath, 'utf8');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.strictEqual(
      manifest.version,
      versionContent,
      'manifest.version must equal VERSION file contents (SVN-03). ' +
      'manifest.version=' + JSON.stringify(manifest.version) +
      ' VERSION=' + JSON.stringify(versionContent)
    );
  } finally {
    cleanup(tmpDir);
  }
});
