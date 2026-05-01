'use strict';
const { test, describe, afterEach } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const crypto = require('crypto');

const INSTALLER = path.resolve(__dirname, '..', 'bin', 'install.js');

// Resolve a writable temp base — sandbox sets TMPDIR=/tmp/claude which may not exist on disk
const { resolveTmpDir, cleanup } = require('./helpers.cjs');
const BASE_TMPDIR = resolveTmpDir();

// ── TILDE-01: global install uses tilde paths, not absolute home dir ──────────

test('TILDE-01: install.js global install uses tilde paths in workflow files (no PII leak)', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-tilde-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--global'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, {
          HOME: os.homedir(),
          CLAUDE_CONFIG_DIR: path.join(tmpDir, '.claude'),
        }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --global must exit 0 (TILDE-01)\nstderr: ' +
        (result.stderr || ''),
    );

    const workflowsDir = path.join(tmpDir, '.claude', 'gsd-ng', 'workflows');
    const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.md'));
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
        'Offending files: ' +
        badFiles.join(', ') +
        '\n' +
        'Home dir: ' +
        homeDir,
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── UNINSTALL-01: banner shows Mode: Uninstall in uninstall mode ──────────────

test('UNINSTALL-01: install.js --uninstall shows Mode: Uninstall indicator in output', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-uninstall-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--global', '--uninstall'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, {
          HOME: os.homedir(),
          CLAUDE_CONFIG_DIR: path.join(tmpDir, '.claude'),
        }),
      },
    );

    // Uninstall may exit 0 even if directory doesn't exist
    const output = result.stdout || '';
    assert.ok(
      output.includes('Mode: Uninstall'),
      'install.js --uninstall must show "Mode: Uninstall" in output (UNINSTALL-01).\n' +
        'Actual stdout: ' +
        output.slice(0, 500),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PATH-03: local install produces $CLAUDE_PROJECT_DIR paths, not $HOME ──────

test('PATH-03: install.js local install uses $CLAUDE_PROJECT_DIR in workflow bash blocks', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-path-local-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    // Non-interactive: exit 0 expected
    assert.strictEqual(
      result.status,
      0,
      'install.js --local must exit 0 (PATH-03)\nstderr: ' +
        (result.stderr || ''),
    );

    const workflowsDir = path.join(tmpDir, '.claude', 'gsd-ng', 'workflows');
    const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.md'));
    assert.ok(files.length > 0, 'workflows dir must contain .md files');

    let badPathFound = false;
    let goodPathFound = false;
    const badFiles = [];
    for (const fname of files) {
      const content = fs.readFileSync(path.join(workflowsDir, fname), 'utf8');
      // Must NOT contain raw $HOME/.claude/ or ~/.claude/ in installed files
      if (
        content.includes('$HOME/.claude/') ||
        content.includes('~/.claude/')
      ) {
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
        'Offending files: ' +
        badFiles.join(', '),
    );
    assert.ok(
      goodPathFound,
      'install.js local install must produce fallback chain ${CLAUDE_PROJECT_DIR:-$(git rev-parse...)}/.claude/ in workflow files (PATH-03)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PATH-04: local install must not produce ./.claude/ relative paths ─────────

test('PATH-04: install.js local install must not produce ./.claude/ paths in bash code blocks', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-no-rel-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(result.status, 0, 'install.js --local must exit 0');

    const workflowsDir = path.join(tmpDir, '.claude', 'gsd-ng', 'workflows');
    const files = fs.readdirSync(workflowsDir).filter((f) => f.endsWith('.md'));

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
        'Offending files: ' +
        badFiles.join(', '),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-06: settings-sandbox.json template contains Agent(*), canonical Edit(*)/Write(*)/Read(*),
//            no deny rules, subshell builtins.
//
//            Template uses canonical macOS forms (Edit(*), Write(*), Read(*)).
//            install.js down-converts to bare forms on Linux via getReadEditWriteAllowRules().
//            See 54-CONTEXT.md "Template allow canonicalisation" decision.

test('PERM-06: settings-sandbox.json template contains Agent(*), canonical Edit(*)/Write(*)/Read(*), excludes bare Edit/Write/Read, no deny rules, subshell builtins', () => {
  const templatePath = path.resolve(
    __dirname,
    '..',
    'gsd-ng',
    'templates',
    'settings-sandbox.json',
  );
  const template = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
  const allow = template.permissions.allow;
  assert.ok(allow.includes('Agent(*)'), 'template must include Agent(*)');
  // Template ships canonical macOS form; install.js down-converts to bare on Linux.
  assert.ok(
    allow.includes('Edit(*)'),
    'template must include canonical Edit(*) (down-converted to bare Edit on Linux at install time)',
  );
  assert.ok(
    allow.includes('Write(*)'),
    'template must include canonical Write(*) (down-converted to bare Write on Linux at install time)',
  );
  assert.ok(
    allow.includes('Read(*)'),
    'template must include canonical Read(*) (down-converted to bare Read on Linux at install time)',
  );
  // Two-sided contract: bare forms must NOT be present (ALLOW-17)
  assert.ok(
    !allow.includes('Edit'),
    'template must NOT include bare Edit — use Edit(*)',
  );
  assert.ok(
    !allow.includes('Write'),
    'template must NOT include bare Write — use Write(*)',
  );
  assert.ok(
    !allow.includes('Read'),
    'template must NOT include bare Read — use Read(*)',
  );
  // Deny rules dropped per Phase 52 -- GSD-NG ships allow rules only
  assert.strictEqual(
    template.permissions.deny,
    undefined,
    'template must NOT have permissions.deny section (deny rules dropped in Phase 52)',
  );

  // Verify new subshell builtins were added (Bug 9 fix)
  assert.ok(
    allow.includes('Bash(basename *)'),
    'template must include Bash(basename *)',
  );
  assert.ok(
    allow.includes('Bash(dirname *)'),
    'template must include Bash(dirname *)',
  );
  assert.ok(allow.includes('Bash(cut *)'), 'template must include Bash(cut *)');
  assert.ok(allow.includes('Bash(tee *)'), 'template must include Bash(tee *)');
  assert.ok(
    allow.includes('Bash(uniq *)'),
    'template must include Bash(uniq *)',
  );
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
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install must exit 0 (PERM-07)\nstderr: ' + (result.stderr || ''),
    );

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const allow = settings.permissions.allow;

    // gh is typically installed in CI/dev environments
    // If gh is installed, we should see granular patterns
    try {
      require('child_process').execSync('which gh', {
        stdio: 'ignore',
        timeout: 2000,
      });
      // gh is installed -- verify granular patterns
      assert.ok(
        allow.includes('Bash(gh pr *)'),
        'must include Bash(gh pr *) when gh is installed (PERM-07)',
      );
      assert.ok(
        allow.includes('Bash(gh pr)'),
        'must include Bash(gh pr) when gh is installed (PERM-07)',
      );
      assert.ok(
        allow.includes('Bash(gh issue *)'),
        'must include Bash(gh issue *) when gh is installed (PERM-07)',
      );
      assert.ok(
        !allow.includes('Bash(gh *)'),
        'must NOT include blanket Bash(gh *) (PERM-07)',
      );
      assert.ok(
        !allow.includes('Bash(gh api *)'),
        'must NOT include Bash(gh api *) (PERM-07)',
      );
      assert.ok(
        !allow.includes('Bash(gh extension *)'),
        'must NOT include Bash(gh extension *) (PERM-07)',
      );
    } catch {
      // gh not installed -- just verify no blanket pattern leaked
      assert.ok(
        !allow.includes('Bash(gh *)'),
        'must NOT include blanket Bash(gh *) even without gh installed (PERM-07)',
      );
    }
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-01: local install seeds permissions.allow with template entries ──────

test('PERM-01: local install seeds permissions.allow with template entries (Bash(node *) and Agent(*))', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-perm01-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --local must exit 0 (PERM-01)\nstderr: ' +
        (result.stderr || ''),
    );

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(
      Array.isArray(settings.permissions.allow),
      'settings.permissions.allow must be an array (PERM-01)',
    );
    assert.ok(
      settings.permissions.allow.includes('Bash(node *)'),
      'permissions.allow must include Bash(node *) (PERM-01)',
    );
    assert.ok(
      settings.permissions.allow.includes('Agent(*)'),
      'permissions.allow must include Agent(*) (PERM-01)',
    );
    // Sandbox is default-on: verify sandbox settings are seeded by default (PERM-01 default-on check)
    assert.strictEqual(
      settings.sandbox && settings.sandbox.enabled,
      true,
      'sandbox.enabled must be true by default (PERM-01)',
    );
    assert.strictEqual(
      settings.sandbox && settings.sandbox.autoAllowBashIfSandboxed,
      true,
      'sandbox.autoAllowBashIfSandboxed must be true by default (PERM-01)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-02: running --local install twice produces no duplicate entries ──────

test('PERM-02: running --local install twice produces no duplicate entries in permissions.allow', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-perm02-'));
  try {
    const runInstall = () =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local'],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );
    const r1 = runInstall();
    assert.strictEqual(
      r1.status,
      0,
      'first install must exit 0 (PERM-02)\nstderr: ' + (r1.stderr || ''),
    );
    const r2 = runInstall();
    assert.strictEqual(
      r2.status,
      0,
      'second install must exit 0 (PERM-02)\nstderr: ' + (r2.stderr || ''),
    );

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const allow = settings.permissions.allow;

    const agentCount = allow.filter((e) => e === 'Agent(*)').length;
    assert.strictEqual(
      agentCount,
      1,
      'Agent(*) must appear exactly once after two installs (PERM-02)',
    );

    // Verify idempotency: no duplicate entries after two installs
    // (length may exceed template length when platform CLIs like gh are installed)
    const uniqueEntries = new Set(allow);
    assert.strictEqual(
      uniqueEntries.size,
      allow.length,
      'permissions.allow must have no duplicate entries after two installs (PERM-02)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-03: --no-seed-permissions-config does NOT create permissions.allow ───

test('PERM-03: --local --no-seed-permissions-config does not create permissions.allow in settings.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-perm03-'));
  try {
    const result = spawnSync(
      process.execPath,
      [
        INSTALLER,
        '--runtime',
        'claude',
        '--local',
        '--no-seed-permissions-config',
      ],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --local --no-seed-permissions-config must exit 0 (PERM-03)\nstderr: ' +
        (result.stderr || ''),
    );

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const hasAllow =
      settings.permissions !== undefined &&
      settings.permissions.allow !== undefined;
    assert.ok(
      !hasAllow,
      'permissions.allow must not exist when --no-seed-permissions-config is used (PERM-03)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-04: --no-seed-sandbox-config suppresses sandbox settings seeding ────

test('PERM-04: --local --no-seed-sandbox-config suppresses sandbox settings seeding', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-perm04-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local', '--no-seed-sandbox-config'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --local --no-seed-sandbox-config must exit 0 (PERM-04)\nstderr: ' +
        (result.stderr || ''),
    );

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    // Sandbox seeding should be suppressed when --no-seed-sandbox-config is used
    const sandboxEnabled =
      settings.sandbox !== undefined && settings.sandbox.enabled !== undefined;
    assert.ok(
      !sandboxEnabled,
      'sandbox.enabled must not be set when --no-seed-sandbox-config is used (PERM-04)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── PERM-05: uninstall removes template entries but preserves custom entries ──

test('PERM-05: uninstall removes template-sourced entries from permissions.allow but preserves custom user entries', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-perm05-'));
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
      },
    );
    assert.strictEqual(
      installResult.status,
      0,
      'initial install must exit 0 (PERM-05)\nstderr: ' +
        (installResult.stderr || ''),
    );

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
      },
    );
    assert.strictEqual(
      uninstallResult.status,
      0,
      'uninstall must exit 0 (PERM-05)\nstderr: ' +
        (uninstallResult.stderr || ''),
    );

    // Check settings after uninstall
    const settingsAfter = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const allowAfter = settingsAfter.permissions.allow;
    assert.ok(
      allowAfter.includes('Bash(my-custom-tool *)'),
      'custom entry must be preserved after uninstall (PERM-05)',
    );
    assert.ok(
      !allowAfter.includes('Agent(*)'),
      'Agent(*) must be removed after uninstall (PERM-05)',
    );
    assert.ok(
      !allowAfter.includes('Bash(node *)'),
      'Bash(node *) must be removed after uninstall (PERM-05)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── SAND-01: --no-seed-sandbox-config still seeds permissions.allow ───────────

test('SAND-01: --local --no-seed-sandbox-config still seeds permissions.allow', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-sand01-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local', '--no-seed-sandbox-config'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --local --no-seed-sandbox-config must exit 0 (SAND-01)\nstderr: ' +
        (result.stderr || ''),
    );

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));

    // Permissions should still be seeded even when sandbox config is suppressed
    assert.ok(
      Array.isArray(settings.permissions && settings.permissions.allow),
      'permissions.allow must be seeded even when --no-seed-sandbox-config is used (SAND-01)',
    );
    assert.ok(
      settings.permissions.allow.includes('Bash(node *)'),
      'permissions.allow must include Bash(node *) (SAND-01)',
    );
    assert.ok(
      settings.permissions.allow.includes('Agent(*)'),
      'permissions.allow must include Agent(*) (SAND-01)',
    );

    // Sandbox settings must NOT be seeded
    const sandboxEnabled =
      settings.sandbox !== undefined && settings.sandbox.enabled !== undefined;
    assert.ok(
      !sandboxEnabled,
      'sandbox.enabled must not be set when --no-seed-sandbox-config is used (SAND-01)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── RUNTIME-01: --local without --runtime exits non-zero ──────────────────────

test('RUNTIME-01: --local without --runtime exits non-zero with helpful error', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-rt01-'));
  try {
    const result = spawnSync(process.execPath, [INSTALLER, '--local'], {
      encoding: 'utf8',
      timeout: 15000,
      cwd: tmpDir,
      env: Object.assign({}, process.env, { HOME: os.homedir() }),
    });
    assert.notStrictEqual(
      result.status,
      0,
      '--local without --runtime must exit non-zero (RUNTIME-01)',
    );
    const output = (result.stderr || '') + (result.stdout || '');
    assert.ok(
      output.includes('Error: --runtime required'),
      'must show "Error: --runtime required" message (RUNTIME-01)\nActual output: ' +
        output.slice(0, 500),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── RUNTIME-02: --global without --runtime exits non-zero ─────────────────────

test('RUNTIME-02: --global without --runtime exits non-zero with helpful error', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-rt02-'));
  try {
    const result = spawnSync(process.execPath, [INSTALLER, '--global'], {
      encoding: 'utf8',
      timeout: 15000,
      cwd: tmpDir,
      env: Object.assign({}, process.env, {
        HOME: os.homedir(),
        CLAUDE_CONFIG_DIR: path.join(tmpDir, '.claude'),
      }),
    });
    assert.notStrictEqual(
      result.status,
      0,
      '--global without --runtime must exit non-zero (RUNTIME-02)',
    );
    const output = (result.stderr || '') + (result.stdout || '');
    assert.ok(
      output.includes('Error: --runtime required'),
      'must show "Error: --runtime required" message (RUNTIME-02)\nActual output: ' +
        output.slice(0, 500),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── RUNTIME-03: --uninstall without --runtime exits non-zero ──────────────────

test('RUNTIME-03: --uninstall --local without --runtime exits non-zero', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-rt03-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--local', '--uninstall'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.notStrictEqual(
      result.status,
      0,
      '--uninstall without --runtime must exit non-zero (RUNTIME-03)',
    );
    const output = (result.stderr || '') + (result.stdout || '');
    assert.ok(
      output.includes('Error: --runtime required'),
      'must show "Error: --runtime required" message (RUNTIME-03)\nActual output: ' +
        output.slice(0, 500),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-01: --local --copilot creates skills/gsd-*/SKILL.md ──────────────

test('COPILOT-01: --local --copilot creates skills/gsd-*/SKILL.md from commands', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-01)\nstderr: ' +
        (result.stderr || ''),
    );

    const skillsDir = path.join(tmpDir, '.github', 'skills');
    assert.ok(
      fs.existsSync(skillsDir),
      '.github/skills/ directory must exist (COPILOT-01)',
    );

    const skillDirs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('gsd-'));
    assert.ok(
      skillDirs.length > 0,
      'at least one gsd-* subdirectory must exist under skills/ (COPILOT-01)',
    );

    for (const skillDir of skillDirs) {
      const skillMd = path.join(skillsDir, skillDir.name, 'SKILL.md');
      assert.ok(
        fs.existsSync(skillMd),
        `skills/${skillDir.name}/SKILL.md must exist (COPILOT-01)`,
      );
    }
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-02: --local --copilot creates agents/gsd-*.agent.md ──────────────

test('COPILOT-02: --local --copilot creates agents/gsd-*.agent.md files', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-02)\nstderr: ' +
        (result.stderr || ''),
    );

    const agentsDir = path.join(tmpDir, '.github', 'agents');
    assert.ok(
      fs.existsSync(agentsDir),
      '.github/agents/ directory must exist (COPILOT-02)',
    );

    const agentFiles = fs
      .readdirSync(agentsDir)
      .filter((f) => f.startsWith('gsd-') && f.endsWith('.agent.md'));
    assert.ok(
      agentFiles.length > 0,
      'at least one gsd-*.agent.md file must exist (COPILOT-02)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-03: --local --copilot generates copilot-instructions.md ───────────

test('COPILOT-03: --local --copilot generates copilot-instructions.md with GSD markers', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-03)\nstderr: ' +
        (result.stderr || ''),
    );

    const instructionsPath = path.join(
      tmpDir,
      '.github',
      'copilot-instructions.md',
    );
    assert.ok(
      fs.existsSync(instructionsPath),
      '.github/copilot-instructions.md must exist (COPILOT-03)',
    );

    const content = fs.readFileSync(instructionsPath, 'utf8');
    assert.ok(
      content.includes('<!-- GSD Configuration'),
      'copilot-instructions.md must contain GSD open marker (COPILOT-03)',
    );
    assert.ok(
      content.includes('<!-- /GSD Configuration -->'),
      'copilot-instructions.md must contain GSD close marker (COPILOT-03)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-04: --local --copilot does NOT create settings.json ───────────────

test('COPILOT-04: --local --copilot does NOT create settings.json', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-04)\nstderr: ' +
        (result.stderr || ''),
    );

    const settingsPath = path.join(tmpDir, '.github', 'settings.json');
    assert.ok(
      !fs.existsSync(settingsPath),
      '.github/settings.json must NOT exist for Copilot install (COPILOT-04)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-05: --local --copilot does NOT seed permissions or sandbox ────────

test('COPILOT-05: --local --copilot does NOT seed permissions or sandbox settings', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-05)\nstderr: ' +
        (result.stderr || ''),
    );

    const githubDir = path.join(tmpDir, '.github');

    // No settings.json anywhere in .github/
    const settingsPath = path.join(githubDir, 'settings.json');
    assert.ok(
      !fs.existsSync(settingsPath),
      'No settings.json must exist in .github/ for Copilot install (COPILOT-05)',
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
          `${jsonFile} must not contain "permissions" key in Copilot install (COPILOT-05)`,
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
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-copilot-'));
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
      },
    );
    assert.strictEqual(
      installResult.status,
      0,
      'install must exit 0 (COPILOT-06)\nstderr: ' +
        (installResult.stderr || ''),
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
      },
    );
    assert.strictEqual(
      uninstallResult.status,
      0,
      'uninstall must exit 0 (COPILOT-06)\nstderr: ' +
        (uninstallResult.stderr || ''),
    );

    const githubDir = path.join(tmpDir, '.github');

    // No gsd-* directories under skills/
    const skillsDir = path.join(githubDir, 'skills');
    if (fs.existsSync(skillsDir)) {
      const remainingSkills = fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && e.name.startsWith('gsd-'));
      assert.strictEqual(
        remainingSkills.length,
        0,
        'no gsd-* skill directories should remain after uninstall (COPILOT-06)',
      );
    }

    // No gsd-*.agent.md files under agents/
    const agentsDir = path.join(githubDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      const remainingAgents = fs
        .readdirSync(agentsDir)
        .filter((f) => f.startsWith('gsd-') && f.endsWith('.agent.md'));
      assert.strictEqual(
        remainingAgents.length,
        0,
        'no gsd-*.agent.md files should remain after uninstall (COPILOT-06)',
      );
    }

    // copilot-instructions.md either deleted or stripped of GSD markers
    const instructionsPath = path.join(githubDir, 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      const content = fs.readFileSync(instructionsPath, 'utf8');
      assert.ok(
        !content.includes('<!-- GSD Configuration'),
        'copilot-instructions.md must not contain GSD markers after uninstall (COPILOT-06)',
      );
    }

    // gsd-ng/ directory removed
    const gsdNgDir = path.join(githubDir, 'gsd-ng');
    assert.ok(
      !fs.existsSync(gsdNgDir),
      'gsd-ng/ directory must be removed after uninstall (COPILOT-06)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-07: no leaked ~/.claude/ paths in Copilot installed content ───────

test('COPILOT-07: --local --copilot installed files contain no ~/.claude/ or .claude/ path references', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (COPILOT-07)\nstderr: ' +
        (result.stderr || ''),
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
    assert.ok(
      mdFiles.length > 0,
      'must have installed .md files to check (COPILOT-07)',
    );

    const badFiles = [];
    for (const mdFile of mdFiles) {
      const content = fs.readFileSync(mdFile, 'utf8');
      // Check for raw ~/.claude/ paths (not .github/ or .copilot/ which are correct)
      if (
        content.includes('~/.claude/') ||
        content.includes('$HOME/.claude/') ||
        content.includes('./.claude/')
      ) {
        badFiles.push(path.relative(tmpDir, mdFile));
      }
    }

    assert.ok(
      badFiles.length === 0,
      'installed Copilot files must not contain ~/.claude/ or .claude/ paths (COPILOT-07).\n' +
        'Offending files: ' +
        badFiles.join(', '),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── COPILOT-08: --runtime copilot flag works for non-interactive install ──────

test('COPILOT-08: --local --runtime copilot selects Copilot runtime', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-js-copilot-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--local', '--runtime', 'copilot'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --local --runtime copilot must exit 0 (COPILOT-08)\nstderr: ' +
        (result.stderr || ''),
    );

    // .github/ directory must exist (Copilot runtime selected)
    const githubDir = path.join(tmpDir, '.github');
    assert.ok(
      fs.existsSync(githubDir),
      '.github/ directory must exist when --runtime copilot is used (COPILOT-08)',
    );

    // skills/ directory must exist under .github/
    const skillsDir = path.join(githubDir, 'skills');
    assert.ok(
      fs.existsSync(skillsDir),
      '.github/skills/ directory must exist (COPILOT-08)',
    );

    // .claude/ directory must NOT exist (wrong runtime)
    const claudeDir = path.join(tmpDir, '.claude');
    assert.ok(
      !fs.existsSync(claudeDir),
      '.claude/ directory must NOT exist when --runtime copilot is used (COPILOT-08)',
    );
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
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install must exit 0 (COPILOT-09)\nstderr: ' + (result.stderr || ''),
    );

    const hooksFile = path.join(tmpDir, '.github', 'hooks', 'gsd-hooks.json');
    assert.ok(
      fs.existsSync(hooksFile),
      '.github/hooks/gsd-hooks.json must exist after Copilot install (COPILOT-09)',
    );

    const content = JSON.parse(fs.readFileSync(hooksFile, 'utf8'));
    assert.strictEqual(
      content.version,
      1,
      'hooks file must have version: 1 (COPILOT-09)',
    );
    assert.ok(
      Array.isArray(content.hooks.sessionStart),
      'hooks.sessionStart must be an array (COPILOT-09)',
    );
    assert.ok(
      content.hooks.sessionStart.length > 0,
      'sessionStart must have at least one hook entry (COPILOT-09)',
    );
    assert.ok(
      content.hooks.sessionStart[0].bash.includes('gsd-check-update'),
      'sessionStart hook bash command must reference gsd-check-update (COPILOT-09)',
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
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime claude --local must exit 0 (BASH-HOOK-01)\nstderr: ' +
        (result.stderr || ''),
    );
    const hookPath = path.join(
      tmpDir,
      '.claude',
      'hooks',
      'bash-safety-hook.cjs',
    );
    assert.ok(
      fs.existsSync(hookPath),
      'hooks/bash-safety-hook.cjs must exist after claude local install (BASH-HOOK-01)',
    );
    const content = fs.readFileSync(hookPath, 'utf8');
    assert.ok(
      content.startsWith('#!/usr/bin/env node'),
      'bash-safety-hook.cjs must start with #!/usr/bin/env node shebang (BASH-HOOK-01)',
    );
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
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime claude --local must exit 0 (BASH-HOOK-02)\nstderr: ' +
        (result.stderr || ''),
    );
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    assert.ok(
      fs.existsSync(settingsPath),
      'settings.json must exist after claude local install (BASH-HOOK-02)',
    );
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const preToolUse = settings.hooks && settings.hooks.PreToolUse;
    assert.ok(
      Array.isArray(preToolUse),
      'settings.json must have hooks.PreToolUse array (BASH-HOOK-02)',
    );
    const bashSafetyEntry = preToolUse.find(
      (entry) =>
        entry.hooks &&
        entry.hooks.some(
          (h) => h.command && h.command.includes('bash-safety-hook.cjs'),
        ),
    );
    assert.ok(
      bashSafetyEntry !== undefined,
      'settings.json PreToolUse must contain an entry with bash-safety-hook.cjs (BASH-HOOK-02)',
    );
    assert.strictEqual(
      bashSafetyEntry.matcher,
      'Bash',
      'bash-safety-hook entry must have matcher: "Bash" (BASH-HOOK-02)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── BASH-HOOK-03: idempotent — re-running does not duplicate hook in PreToolUse ──

test('BASH-HOOK-03: idempotent — re-running install does not duplicate bash-safety-hook in PreToolUse', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-bh-03-'));
  try {
    const runInstall = () =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local'],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );
    const r1 = runInstall();
    assert.strictEqual(
      r1.status,
      0,
      'First install must exit 0 (BASH-HOOK-03)',
    );
    const r2 = runInstall();
    assert.strictEqual(
      r2.status,
      0,
      'Second install must exit 0 (BASH-HOOK-03)',
    );
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const preToolUse = settings.hooks && settings.hooks.PreToolUse;
    const bashSafetyEntries = (preToolUse || []).filter(
      (entry) =>
        entry.hooks &&
        entry.hooks.some(
          (h) => h.command && h.command.includes('bash-safety-hook.cjs'),
        ),
    );
    assert.strictEqual(
      bashSafetyEntries.length,
      1,
      'bash-safety-hook.cjs must appear exactly once in PreToolUse after two installs (BASH-HOOK-03). ' +
        'Found: ' +
        bashSafetyEntries.length +
        ' entries',
    );
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
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (BASH-HOOK-04)\nstderr: ' +
        (result.stderr || ''),
    );
    const settingsPath = path.join(tmpDir, '.github', 'settings.json');
    if (fs.existsSync(settingsPath)) {
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
      const preToolUse = (settings.hooks && settings.hooks.PreToolUse) || [];
      const hasBashSafety = preToolUse.some(
        (entry) =>
          entry.hooks &&
          entry.hooks.some(
            (h) => h.command && h.command.includes('bash-safety-hook.cjs'),
          ),
      );
      assert.ok(
        !hasBashSafety,
        'copilot settings.json must NOT contain bash-safety-hook.cjs in PreToolUse (BASH-HOOK-04)',
      );
    }
    // Guardrail: hook file must not exist in Copilot target (future runtime safety)
    const hookFilePath = path.join(
      tmpDir,
      '.github',
      'hooks',
      'bash-safety-hook.cjs',
    );
    assert.ok(
      !fs.existsSync(hookFilePath),
      'bash-safety-hook.cjs must NOT exist in Copilot hooks dir (BASH-HOOK-04)',
    );
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
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime claude --local must exit 0 (BASH-HOOK-05)\nstderr: ' +
        (result.stderr || ''),
    );
    const agentCtxPath = path.join(
      tmpDir,
      '.claude',
      'gsd-ng',
      'references',
      'agent-shared-context.md',
    );
    assert.ok(
      fs.existsSync(agentCtxPath),
      'agent-shared-context.md must exist after claude local install (BASH-HOOK-05)',
    );
    const content = fs.readFileSync(agentCtxPath, 'utf8');
    assert.ok(
      content.includes('ALWAYS use the Write tool'),
      'agent-shared-context.md must contain anti-heredoc instruction (BASH-HOOK-05)',
    );
    assert.ok(
      !content.includes('GSD — AST Safety Rules'),
      'agent-shared-context.md must NOT contain AST Safety Rules markers (BASH-HOOK-05)',
    );
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
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (BASH-HOOK-06)\nstderr: ' +
        (result.stderr || ''),
    );
    const agentCtxPath = path.join(
      tmpDir,
      '.github',
      'gsd-ng',
      'references',
      'agent-shared-context.md',
    );
    assert.ok(
      fs.existsSync(agentCtxPath),
      'agent-shared-context.md must exist after copilot local install (BASH-HOOK-06)',
    );
    const content = fs.readFileSync(agentCtxPath, 'utf8');
    assert.ok(
      content.includes('ALWAYS use the Write tool'),
      'agent-shared-context.md must contain anti-heredoc instruction for copilot runtime too (BASH-HOOK-06)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── BASH-HOOK-07: anti-heredoc not duplicated on re-install ──────────────────

test('BASH-HOOK-07: anti-heredoc not duplicated on re-install of claude local', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-bh-07-'));
  try {
    const runInstall = () =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local'],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );
    assert.strictEqual(
      runInstall().status,
      0,
      'First install must exit 0 (BASH-HOOK-07)',
    );
    assert.strictEqual(
      runInstall().status,
      0,
      'Second install must exit 0 (BASH-HOOK-07)',
    );
    const agentCtxPath = path.join(
      tmpDir,
      '.claude',
      'gsd-ng',
      'references',
      'agent-shared-context.md',
    );
    const content = fs.readFileSync(agentCtxPath, 'utf8');
    const occurrences = (content.match(/ALWAYS use the Write tool/g) || [])
      .length;
    assert.strictEqual(
      occurrences,
      1,
      '"ALWAYS use the Write tool" must appear exactly once after two installs (BASH-HOOK-07). Found: ' +
        occurrences,
    );
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
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install must exit 0 (COPILOT-10)\nstderr: ' + (result.stderr || ''),
    );

    const skillsDir = path.join(tmpDir, '.github', 'skills');
    assert.ok(
      fs.existsSync(skillsDir),
      '.github/skills/ must exist (COPILOT-10)',
    );

    const skillDirs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((e) => e.isDirectory() && e.name.startsWith('gsd-'));
    assert.ok(
      skillDirs.length > 0,
      'at least one gsd-* skill dir must exist (COPILOT-10)',
    );

    const offending = [];
    for (const skillDir of skillDirs) {
      const skillMd = path.join(skillsDir, skillDir.name, 'SKILL.md');
      if (!fs.existsSync(skillMd)) continue;
      const content = fs.readFileSync(skillMd, 'utf8');
      // Extract name: line from frontmatter
      const nameMatch = content.match(/^name:\s*(.+)$/m);
      if (nameMatch && nameMatch[1].includes(':')) {
        offending.push(
          `${skillDir.name}/SKILL.md → name: ${nameMatch[1].trim()}`,
        );
      }
    }

    assert.strictEqual(
      offending.length,
      0,
      'SKILL.md name: fields must not contain colons (COPILOT-10).\n' +
        'Offending files:\n' +
        offending.map((s) => '  ' + s).join('\n'),
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
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime copilot --local must exit 0 (SVN-01)\nstderr: ' +
        (result.stderr || ''),
    );

    const versionPath = path.join(tmpDir, '.github', 'gsd-ng', 'VERSION');
    assert.ok(
      fs.existsSync(versionPath),
      '.github/gsd-ng/VERSION must exist after copilot install (SVN-01)',
    );

    const versionContent = fs.readFileSync(versionPath, 'utf8').trim();
    const pkg = require('../package.json');
    // Accept both clean version (tagged release) and snapshot version+hash (dev checkout).
    const snapshotRegex = new RegExp(
      '^' + pkg.version.replace(/[.+]/g, '\\$&') + '(\\+[0-9a-f]{7,})?$',
    );
    assert.ok(
      snapshotRegex.test(versionContent),
      'copilot VERSION must match ' +
        snapshotRegex +
        ' (SVN-01). Got: ' +
        JSON.stringify(versionContent),
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
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime claude --local must exit 0 (SVN-02)\nstderr: ' +
        (result.stderr || ''),
    );

    const versionPath = path.join(tmpDir, '.claude', 'gsd-ng', 'VERSION');
    assert.ok(
      fs.existsSync(versionPath),
      '.claude/gsd-ng/VERSION must exist (SVN-02)',
    );
    const versionContent = fs.readFileSync(versionPath, 'utf8').trim();

    // Banner line format: "  gsd-ng \x1b[2mv<version>\x1b[0m\n"
    // Strip ANSI and check the banner contains "gsd-ng v<versionContent>".
    const stdout = result.stdout || '';
    // Remove ANSI escape sequences for readable matching.
    const clean = stdout.replace(/\x1b\[[0-9;]*m/g, '');
    const expectedBannerFragment = 'gsd-ng v' + versionContent;
    assert.ok(
      clean.includes(expectedBannerFragment),
      'Banner must contain "' +
        expectedBannerFragment +
        '" matching VERSION file (SVN-02).\n' +
        'Stdout (ANSI-stripped, first 500 chars): ' +
        clean.slice(0, 500),
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
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime claude --local must exit 0 (SVN-03)\nstderr: ' +
        (result.stderr || ''),
    );

    const versionPath = path.join(tmpDir, '.claude', 'gsd-ng', 'VERSION');
    const manifestPath = path.join(tmpDir, '.claude', 'gsd-file-manifest.json');
    assert.ok(fs.existsSync(versionPath), 'VERSION must exist (SVN-03)');
    assert.ok(
      fs.existsSync(manifestPath),
      'gsd-file-manifest.json must exist (SVN-03)',
    );

    const versionContent = fs.readFileSync(versionPath, 'utf8');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

    assert.strictEqual(
      manifest.version,
      versionContent,
      'manifest.version must equal VERSION file contents (SVN-03). ' +
        'manifest.version=' +
        JSON.stringify(manifest.version) +
        ' VERSION=' +
        JSON.stringify(versionContent),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── RUNTIME-01: install.js writes runtime field to .planning/config.json ─────

test('RUNTIME-01: install.js --runtime claude writes "runtime":"claude" to .planning/config.json', () => {
  const tmpDir = fs.mkdtempSync(
    path.join(BASE_TMPDIR, 'gsd-js-runtime-claude-'),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --local --runtime claude must exit 0 (RUNTIME-01)\nstderr: ' +
        (result.stderr || ''),
    );

    const configPath = path.join(tmpDir, '.planning', 'config.json');
    assert.ok(
      fs.existsSync(configPath),
      '.planning/config.json must exist after install (RUNTIME-01)',
    );

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.strictEqual(
      config.runtime,
      'claude',
      'config.json must contain "runtime":"claude" after claude install (RUNTIME-01)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

test('RUNTIME-02: install.js --runtime copilot writes "runtime":"copilot" to .planning/config.json', () => {
  const tmpDir = fs.mkdtempSync(
    path.join(BASE_TMPDIR, 'gsd-js-runtime-copilot-'),
  );
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js --local --runtime copilot must exit 0 (RUNTIME-02)\nstderr: ' +
        (result.stderr || ''),
    );

    const configPath = path.join(tmpDir, '.planning', 'config.json');
    assert.ok(
      fs.existsSync(configPath),
      '.planning/config.json must exist after copilot install (RUNTIME-02)',
    );

    const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    assert.strictEqual(
      config.runtime,
      'copilot',
      'config.json must contain "runtime":"copilot" after copilot install (RUNTIME-02)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── ALLOW-18: env var rename — GSD_TEST_FORCE_PLATFORM is the test seam ────────

test('ALLOW-18: install.js seeding block uses GSD_TEST_FORCE_PLATFORM (not GSD_FORCE_PLATFORM)', () => {
  // Static code inspection: the source must not reference the old env var name
  const src = fs.readFileSync(INSTALLER, 'utf8');
  assert.ok(
    !src.includes('GSD_FORCE_PLATFORM'),
    'install.js must not reference GSD_FORCE_PLATFORM (old name) — use GSD_TEST_FORCE_PLATFORM (ALLOW-18)',
  );
  assert.ok(
    src.includes('GSD_TEST_FORCE_PLATFORM'),
    'install.js must reference GSD_TEST_FORCE_PLATFORM at least once (ALLOW-18)',
  );
});

// ── ALLOW-19: RW_FORMS imported from allowlist.cjs — no inline Set literal ──────

test('ALLOW-19: install.js imports RW_FORMS from allowlist.cjs and uses no inline rwForms Set literal', () => {
  const src = fs.readFileSync(INSTALLER, 'utf8');
  // Must import RW_FORMS in the destructure
  assert.ok(
    src.includes('RW_FORMS'),
    'install.js must import and reference RW_FORMS from allowlist.cjs (ALLOW-19)',
  );
  // Must not define an inline Set containing these canonical forms
  assert.ok(
    !src.includes("new Set(['Edit', 'Write', 'Read'"),
    'install.js must not define an inline rwForms Set literal — use imported RW_FORMS (ALLOW-19)',
  );
});

// ── ALLOW-19: GSD_TEST_FORCE_PLATFORM seam works at runtime ─────────────────────

test('ALLOW-19: GSD_TEST_FORCE_PLATFORM env var controls platform detection in seeding block', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-allow19-'));
  try {
    // Install with GSD_TEST_FORCE_PLATFORM overriding to 'linux'
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, {
          HOME: os.homedir(),
          GSD_TEST_FORCE_PLATFORM: 'linux',
        }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js must exit 0 when GSD_TEST_FORCE_PLATFORM=linux is set (ALLOW-19)\nstderr: ' +
        (result.stderr || ''),
    );
    // settings.json must have been seeded (permissions block present)
    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    assert.ok(
      fs.existsSync(settingsPath),
      'settings.json must exist (ALLOW-19)',
    );
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    assert.ok(
      Array.isArray(settings.permissions && settings.permissions.allow),
      'permissions.allow must be seeded when GSD_TEST_FORCE_PLATFORM is used (ALLOW-19)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── ALLOW-20: syncSection uses Set.has() for O(1) membership ─────────────────

test('ALLOW-20: install.js syncSection uses Set.has() — not Array.includes() — for membership check', () => {
  const src = fs.readFileSync(INSTALLER, 'utf8');
  // New implementation: must use Set.has()
  assert.ok(
    src.includes('existingSet.has(e)'),
    'syncSection must use existingSet.has(e) for membership check (ALLOW-20)',
  );
  // Old implementation: must not use Array.includes()
  assert.ok(
    !src.includes('existing.includes(e)'),
    'syncSection must not use existing.includes(e) — replaced by Set.has() (ALLOW-20)',
  );
  // Return shape: merged and added fields must still be present
  assert.ok(
    src.includes('merged: [...existing, ...toAdd]'),
    'syncSection must keep merged: [...existing, ...toAdd] return shape (ALLOW-20)',
  );
});

test('RUNTIME-03: install.js preserves existing config.json values when writing runtime field', () => {
  const tmpDir = fs.mkdtempSync(
    path.join(BASE_TMPDIR, 'gsd-js-runtime-preserve-'),
  );
  try {
    // Create .planning dir and pre-existing config.json with some values
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ model_profile: 'quality', commit_docs: false }, null, 2),
      'utf-8',
    );

    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js must exit 0 even when config.json already exists (RUNTIME-03)\nstderr: ' +
        (result.stderr || ''),
    );

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.planning', 'config.json'), 'utf8'),
    );
    assert.strictEqual(
      config.runtime,
      'claude',
      'runtime field must be added (RUNTIME-03)',
    );
    assert.strictEqual(
      config.model_profile,
      'quality',
      'existing model_profile must be preserved (RUNTIME-03)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

test('RUNTIME-04: install.js updates existing runtime field in config.json', () => {
  const tmpDir = fs.mkdtempSync(
    path.join(BASE_TMPDIR, 'gsd-js-runtime-update-'),
  );
  try {
    // Pre-create config.json with runtime: copilot
    fs.mkdirSync(path.join(tmpDir, '.planning'), { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, '.planning', 'config.json'),
      JSON.stringify({ runtime: 'copilot' }, null, 2),
      'utf-8',
    );

    // Install with claude runtime — should update to claude
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );

    assert.strictEqual(
      result.status,
      0,
      'install.js must exit 0 (RUNTIME-04)\nstderr: ' + (result.stderr || ''),
    );

    const config = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.planning', 'config.json'), 'utf8'),
    );
    assert.strictEqual(
      config.runtime,
      'claude',
      'runtime must be updated from copilot to claude (RUNTIME-04)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── MANIFEST-STAB-01: double-install is idempotent — no phantom local modifications ──

test('MANIFEST-STAB-01: running --local claude install twice produces no "Found N locally modified" output and no populated gsd-local-patches/', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-manifest-stab-'));
  try {
    const runInstall = () =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local'],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );
    const r1 = runInstall();
    assert.strictEqual(
      r1.status,
      0,
      'first install must exit 0 (MANIFEST-STAB-01)\nstderr: ' +
        (r1.stderr || ''),
    );
    const r2 = runInstall();
    assert.strictEqual(
      r2.status,
      0,
      'second install must exit 0 (MANIFEST-STAB-01)\nstderr: ' +
        (r2.stderr || ''),
    );

    const r2Stdout = r2.stdout || '';
    assert.ok(
      !/Found \d+ locally modified GSD file/.test(r2Stdout),
      'second install must NOT report locally modified GSD files (MANIFEST-STAB-01).\n' +
        'stdout: ' +
        r2Stdout.slice(0, 2000),
    );

    // gsd-local-patches either does not exist, or contains only meta/placeholder entries.
    const patchesDir = path.join(tmpDir, '.claude', 'gsd-local-patches');
    if (fs.existsSync(patchesDir)) {
      const entries = fs
        .readdirSync(patchesDir)
        .filter((e) => e !== '.gitkeep');
      assert.strictEqual(
        entries.length,
        0,
        'gsd-local-patches/ must be empty after double install (MANIFEST-STAB-01). Entries: ' +
          entries.join(', '),
      );
    }
  } finally {
    cleanup(tmpDir);
  }
});

// ── TEMPLATE-RESOLVE-01: no unresolved {{…}} tokens in deployed .md files ──

test('TEMPLATE-RESOLVE-01: after single --local claude install, no .md file under commands/gsd/ or gsd-ng/ contains {{USER_QUESTION_TOOL}} or {{PROJECT_RULES_FILE}}', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-tpl-resolve-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install must exit 0 (TEMPLATE-RESOLVE-01)\nstderr: ' +
        (result.stderr || ''),
    );

    const roots = [
      path.join(tmpDir, '.claude', 'commands', 'gsd'),
      path.join(tmpDir, '.claude', 'gsd-ng'),
    ];
    const BAD_TOKENS = ['{{USER_QUESTION_TOOL}}', '{{PROJECT_RULES_FILE}}'];

    function walk(dir, out) {
      if (!fs.existsSync(dir)) return;
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile() && entry.name.endsWith('.md')) out.push(full);
      }
    }

    const mdFiles = [];
    for (const root of roots) walk(root, mdFiles);
    assert.ok(
      mdFiles.length > 0,
      'expected deployed .md files to exist under commands/gsd/ and gsd-ng/ (TEMPLATE-RESOLVE-01)',
    );

    const offenders = [];
    for (const f of mdFiles) {
      const content = fs.readFileSync(f, 'utf8');
      for (const tok of BAD_TOKENS) {
        if (content.includes(tok)) {
          offenders.push(path.relative(tmpDir, f) + ' :: ' + tok);
          break;
        }
      }
    }
    assert.strictEqual(
      offenders.length,
      0,
      'unresolved template tokens found in deployed .md files (TEMPLATE-RESOLVE-01):\n' +
        offenders.slice(0, 20).join('\n'),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── MANIFEST-DISK-01: every manifest entry hashes to the on-disk file SHA256 ──

test('MANIFEST-DISK-01: after single --local claude install, gsd-file-manifest.json entries match SHA256 of deployed files', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-manifest-disk-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install must exit 0 (MANIFEST-DISK-01)\nstderr: ' +
        (result.stderr || ''),
    );

    const configDir = path.join(tmpDir, '.claude');
    const manifestPath = path.join(configDir, 'gsd-file-manifest.json');
    assert.ok(
      fs.existsSync(manifestPath),
      'gsd-file-manifest.json must exist (MANIFEST-DISK-01)',
    );

    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.ok(
      manifest.files && typeof manifest.files === 'object',
      'manifest.files must be an object',
    );
    const entries = Object.entries(manifest.files);
    assert.ok(entries.length > 0, 'manifest.files must be non-empty');

    const mismatches = [];
    for (const [relPath, storedHash] of entries) {
      const full = path.join(configDir, relPath);
      if (!fs.existsSync(full)) {
        mismatches.push(relPath + ' :: MISSING_FILE');
        continue;
      }
      const actual = crypto
        .createHash('sha256')
        .update(fs.readFileSync(full))
        .digest('hex');
      if (actual !== storedHash) {
        mismatches.push(
          relPath +
            ' :: manifest=' +
            storedHash.slice(0, 12) +
            ' disk=' +
            actual.slice(0, 12),
        );
      }
    }
    assert.strictEqual(
      mismatches.length,
      0,
      'manifest hashes must match on-disk SHA256 (MANIFEST-DISK-01):\n' +
        mismatches.slice(0, 20).join('\n'),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── MANIFEST-V2-01: writeManifest writes schema_version: 2 ──────────────────

test('MANIFEST-V2-01: writeManifest writes schema_version: 2 in fresh manifest', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-manifest-v2-01-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install must exit 0 (MANIFEST-V2-01)\nstderr: ' + (result.stderr || ''),
    );
    const manifestPath = path.join(tmpDir, '.claude', 'gsd-file-manifest.json');
    assert.ok(
      fs.existsSync(manifestPath),
      'gsd-file-manifest.json must exist (MANIFEST-V2-01)',
    );
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.strictEqual(
      manifest.schema_version,
      2,
      'manifest.schema_version must be integer 2 (MANIFEST-V2-01)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── MANIFEST-V2-02: v1 manifest triggers migration notice and refreshes files ─

test('MANIFEST-V2-02: v1 manifest (missing schema_version) triggers migration notice and refreshes files', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-manifest-v2-02-'));
  try {
    const runInstall = () =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local'],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );

    // First install — establishes v2 manifest
    const r1 = runInstall();
    assert.strictEqual(
      r1.status,
      0,
      'first install must exit 0 (MANIFEST-V2-02)\nstderr: ' +
        (r1.stderr || ''),
    );

    // Strip schema_version to simulate a v1 manifest
    const mPath = path.join(tmpDir, '.claude', 'gsd-file-manifest.json');
    const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    delete m.schema_version;

    // Pick the first managed file from the manifest to mutate
    const managedFiles = Object.keys(m.files || {});
    assert.ok(
      managedFiles.length > 0,
      'manifest must have at least one managed file (MANIFEST-V2-02)',
    );
    const targetRelPath = managedFiles[0];
    const targetAbsPath = path.join(tmpDir, '.claude', targetRelPath);

    fs.writeFileSync(mPath, JSON.stringify(m, null, 2));
    fs.appendFileSync(targetAbsPath, '\n<!-- LOCAL EDIT MARKER -->\n');

    // Second install — should detect v1 manifest and run migration
    const r2 = runInstall();
    assert.strictEqual(
      r2.status,
      0,
      'second install must exit 0 (MANIFEST-V2-02)\nstderr: ' +
        (r2.stderr || ''),
    );

    const r2Stdout = r2.stdout || '';
    assert.match(
      r2Stdout,
      /Migrated manifest to v2 — files refreshed from source/,
      'migration notice must appear in stdout (MANIFEST-V2-02)',
    );
    assert.match(
      r2Stdout,
      /Your modifications were backed up to/,
      'backup notice must appear because file was mutated (MANIFEST-V2-02)',
    );

    // Patches dir must exist and contain the mutated file
    const patchesDir = path.join(tmpDir, '.claude', 'gsd-local-patches');
    assert.ok(
      fs.existsSync(patchesDir),
      'gsd-local-patches/ must exist after migration (MANIFEST-V2-02)',
    );

    // Fresh v2 manifest must have been written
    const m2 = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    assert.strictEqual(
      m2.schema_version,
      2,
      'manifest must be re-written as v2 after migration (MANIFEST-V2-02)',
    );

    // reportLocalPatches must be suppressed — no "Local patches detected" prompt
    assert.ok(
      !r2Stdout.includes('Local patches detected'),
      'stdout must NOT contain "Local patches detected" after migration (MANIFEST-V2-02).\nstdout: ' +
        r2Stdout.slice(0, 2000),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── MANIFEST-V2-03: migration does not run when schema_version: 2 already present ─

test('MANIFEST-V2-03: migration does not run when schema_version: 2 already present', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-manifest-v2-03-'));
  try {
    const runInstall = () =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local'],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );

    // First install — writes v2 manifest
    const r1 = runInstall();
    assert.strictEqual(
      r1.status,
      0,
      'first install must exit 0 (MANIFEST-V2-03)\nstderr: ' +
        (r1.stderr || ''),
    );
    assert.ok(
      (r1.stdout || '').includes('Wrote file manifest'),
      'first install stdout must confirm manifest write (MANIFEST-V2-03)',
    );

    // Second install — manifest already at v2, no migration should run
    const r2 = runInstall();
    assert.strictEqual(
      r2.status,
      0,
      'second install must exit 0 (MANIFEST-V2-03)\nstderr: ' +
        (r2.stderr || ''),
    );
    assert.ok(
      !(r2.stdout || '').includes('Migrated manifest to v2'),
      'second install must NOT emit migration notice when schema_version: 2 is already present (MANIFEST-V2-03).\nstdout: ' +
        (r2.stdout || '').slice(0, 2000),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── MANIFEST-V2-04: reportLocalPatches skipped after migration run ───────────

test('MANIFEST-V2-04: reportLocalPatches skipped after migration run', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-manifest-v2-04-'));
  try {
    const runInstall = () =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local'],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );

    // First install
    const r1 = runInstall();
    assert.strictEqual(
      r1.status,
      0,
      'first install must exit 0 (MANIFEST-V2-04)\nstderr: ' +
        (r1.stderr || ''),
    );

    // Simulate v1 manifest and mutate a managed file
    const mPath = path.join(tmpDir, '.claude', 'gsd-file-manifest.json');
    const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    delete m.schema_version;
    const managedFiles = Object.keys(m.files || {});
    assert.ok(
      managedFiles.length > 0,
      'manifest must have managed files (MANIFEST-V2-04)',
    );
    const targetAbsPath = path.join(tmpDir, '.claude', managedFiles[0]);
    fs.writeFileSync(mPath, JSON.stringify(m, null, 2));
    fs.appendFileSync(targetAbsPath, '\n<!-- LOCAL EDIT MARKER -->\n');

    // Second install — migration runs
    const r2 = runInstall();
    assert.strictEqual(
      r2.status,
      0,
      'second install must exit 0 (MANIFEST-V2-04)\nstderr: ' +
        (r2.stderr || ''),
    );

    // reportLocalPatches output must be suppressed
    assert.ok(
      !(r2.stdout || '').includes('Local patches detected'),
      '"Local patches detected" must NOT appear when migration ran (MANIFEST-V2-04).\nstdout: ' +
        (r2.stdout || '').slice(0, 2000),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── CLEAN-01: --clean flag wipes managed dirs before install and produces fresh v2 manifest ──

test('CLEAN-01: --clean flag wipes managed dirs before install and produces fresh v2 manifest', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-clean-01-'));
  try {
    const runInstall = (extraArgs = []) =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local', ...extraArgs],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );
    const r1 = runInstall();
    assert.strictEqual(
      r1.status,
      0,
      'first install must exit 0\nstderr: ' + (r1.stderr || ''),
    );
    // Corrupt the manifest
    const mPath = path.join(tmpDir, '.claude', 'gsd-file-manifest.json');
    fs.writeFileSync(mPath, '{"corrupted":true}');
    const r2 = runInstall(['--clean']);
    assert.strictEqual(
      r2.status,
      0,
      '--clean install must exit 0\nstderr: ' + (r2.stderr || ''),
    );
    const manifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    assert.strictEqual(
      manifest.schema_version,
      2,
      'manifest must have schema_version: 2 after --clean install',
    );
    assert.ok(
      manifest.files && Object.keys(manifest.files).length > 0,
      'manifest.files must be non-empty after --clean install',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── CLEAN-02: --clean leaves gsd-local-patches/ intact ──────────────────────

test('CLEAN-02: --clean leaves gsd-local-patches/ intact', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-clean-02-'));
  try {
    const runInstall = (extraArgs = []) =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local', ...extraArgs],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );
    assert.strictEqual(runInstall().status, 0);
    const patchesDir = path.join(tmpDir, '.claude', 'gsd-local-patches');
    fs.mkdirSync(patchesDir, { recursive: true });
    const sentinelPath = path.join(patchesDir, 'sentinel.txt');
    fs.writeFileSync(sentinelPath, 'sentinel');
    const r = runInstall(['--clean']);
    assert.strictEqual(
      r.status,
      0,
      '--clean must exit 0\nstderr: ' + (r.stderr || ''),
    );
    assert.ok(fs.existsSync(sentinelPath), 'sentinel.txt must survive --clean');
    assert.strictEqual(fs.readFileSync(sentinelPath, 'utf8'), 'sentinel');
    assert.ok(
      fs.existsSync(path.join(tmpDir, '.claude', 'commands', 'gsd')),
      'commands/gsd/ must be re-installed after --clean wipe',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── CLEAN-03: --clean skips migration even when manifest is v1 ───────────────

test('CLEAN-03: --clean skips migration even when manifest is v1 (missing schema_version)', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-clean-03-'));
  try {
    const runInstall = (extraArgs = []) =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local', ...extraArgs],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, { HOME: os.homedir() }),
        },
      );
    assert.strictEqual(runInstall().status, 0);
    // Strip schema_version to simulate v1 manifest
    const mPath = path.join(tmpDir, '.claude', 'gsd-file-manifest.json');
    const m = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    delete m.schema_version;
    fs.writeFileSync(mPath, JSON.stringify(m, null, 2));
    const r = runInstall(['--clean']);
    assert.strictEqual(
      r.status,
      0,
      '--clean must exit 0\nstderr: ' + (r.stderr || ''),
    );
    assert.ok(
      !/Migrated manifest to v2/.test(r.stdout || ''),
      '--clean must NOT trigger migration notice. stdout:\n' +
        (r.stdout || '').slice(0, 1500),
    );
    const finalManifest = JSON.parse(fs.readFileSync(mPath, 'utf8'));
    assert.strictEqual(
      finalManifest.schema_version,
      2,
      'manifest must be v2 after --clean install',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── CLEAN-04: --help output documents --clean ────────────────────────────────

test('CLEAN-04: --help output documents --clean', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-clean-04-'));
  try {
    const r = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--help'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      r.status,
      0,
      '--help must exit 0\nstderr: ' + (r.stderr || ''),
    );
    assert.ok(
      /--clean/.test(r.stdout || ''),
      '--help must mention --clean. stdout:\n' + (r.stdout || ''),
    );
    assert.ok(
      /Wipe/.test(r.stdout || ''),
      '--help must include descriptive copy for --clean (containing "Wipe"). stdout:\n' +
        (r.stdout || ''),
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── Phase 55 effort frontmatter sync integration tests ──────────────────────

describe('install.js - Phase 55 effort frontmatter sync', () => {
  let tmpDir;
  afterEach(() => {
    if (tmpDir) cleanup(tmpDir);
  });

  test('EFFSYNC-INSTALL-01: Claude local install writes effort: max to gsd-planner.md when profile=quality', () => {
    tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-effsync-install-'));
    // Pre-seed config so resolveEffortInternal reads a known profile during install
    const configDir = path.join(tmpDir, '.planning');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'config.json'),
      JSON.stringify({
        runtime: 'claude',
        model_profile: 'quality',
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        INSTALLER,
        '--runtime',
        'claude',
        '--local',
        '--no-seed-permissions-config',
        '--no-seed-sandbox-config',
      ],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 30000 },
    );
    assert.strictEqual(result.status, 0, `install failed: ${result.stderr}`);
    const plannerPath = path.join(
      tmpDir,
      '.claude',
      'agents',
      'gsd-planner.md',
    );
    assert.ok(fs.existsSync(plannerPath), 'gsd-planner.md must be installed');
    const planner = fs.readFileSync(plannerPath, 'utf-8');
    assert.match(
      planner,
      /^effort: max$/m,
      'effort: max must be in frontmatter',
    );
    // Plan 04 emits the restart notice on stderr when changes occur
    assert.ok(
      result.stderr.includes('Restart Claude Code to apply effort changes.'),
      `restart notice missing from stderr: ${result.stderr}`,
    );
  });

  test('EFFSYNC-INSTALL-02: Copilot local install does NOT write effort: to any agent file', () => {
    tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-effsync-copilot-'));
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 30000 },
    );
    assert.strictEqual(result.status, 0, `install failed: ${result.stderr}`);
    const agentsDir = path.join(tmpDir, '.github', 'agents');
    assert.ok(fs.existsSync(agentsDir), 'Copilot agents directory must exist');
    const files = fs
      .readdirSync(agentsDir)
      .filter((f) => f.endsWith('.agent.md'));
    for (const file of files) {
      const content = fs.readFileSync(path.join(agentsDir, file), 'utf-8');
      assert.doesNotMatch(
        content,
        /^effort:/m,
        `${file} must not contain effort:`,
      );
    }
  });

  test('EFFSYNC-INSTALL-03: Copilot local install does NOT deploy gsd-set-profile skill', () => {
    tmpDir = fs.mkdtempSync(
      path.join(BASE_TMPDIR, 'gsd-effsync-copilot-skill-'),
    );
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'copilot', '--local'],
      { cwd: tmpDir, encoding: 'utf-8', timeout: 30000 },
    );
    assert.strictEqual(result.status, 0, `install failed: ${result.stderr}`);
    const setProfileSkill = path.join(
      tmpDir,
      '.github',
      'skills',
      'gsd-set-profile',
      'SKILL.md',
    );
    assert.ok(
      !fs.existsSync(setProfileSkill),
      'gsd-set-profile/SKILL.md must NOT exist for Copilot install',
    );
  });
});

// ── ALLOW-07: install.js writes bare Edit/Write/Read on Linux ─────────────
// Force Linux seeding via GSD_TEST_FORCE_PLATFORM and verify bare Edit/Write/Read
// permissions are written instead of the globbed forms used on non-Linux platforms.

test('ALLOW-07: install.js --local on Linux writes bare Edit/Write/Read forms', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-allow-07-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, {
          HOME: os.homedir(),
          GSD_TEST_FORCE_PLATFORM: 'linux',
        }),
      },
    );
    assert.strictEqual(result.status, 0, `install.js failed: ${result.stderr}`);

    const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
    const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    const allow = settings.permissions?.allow ?? [];

    assert.ok(allow.includes('Edit'), 'Linux must include bare Edit');
    assert.ok(allow.includes('Write'), 'Linux must include bare Write');
    assert.ok(allow.includes('Read'), 'Linux must include bare Read');
    assert.ok(
      !allow.includes('Edit(*)'),
      'Linux must NOT include glob Edit(*)',
    );
    assert.ok(
      !allow.includes('Write(*)'),
      'Linux must NOT include glob Write(*)',
    );
    assert.ok(
      !allow.includes('Read(*)'),
      'Linux must NOT include glob Read(*)',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── ALLOW-08: install.js writes canonical Edit(*)/Write(*)/Read(*) on macOS ──

test('ALLOW-08: install.js --local on macOS writes canonical glob forms', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-allow-08-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, {
          HOME: os.homedir(),
          GSD_TEST_FORCE_PLATFORM: 'darwin',
        }),
      },
    );
    assert.strictEqual(result.status, 0, `install.js failed: ${result.stderr}`);

    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8'),
    );
    const allow = settings.permissions?.allow ?? [];
    assert.ok(allow.includes('Edit(*)'));
    assert.ok(allow.includes('Write(*)'));
    assert.ok(allow.includes('Read(*)'));
    assert.ok(!allow.includes('Edit'), 'macOS must not carry bare Edit');
    // Narrowed verbs land — gated on gh presence on host (ALLOW-22 integration)
    try {
      require('child_process').execSync('which gh', {
        stdio: 'ignore',
        timeout: 2000,
      });
      assert.ok(
        allow.includes('Bash(gh repo view *)'),
        'narrowed repo view must land',
      );
      assert.ok(
        allow.includes('Bash(gh label create *)'),
        'narrowed label create must land',
      );
      assert.ok(
        !allow.includes('Bash(gh repo *)'),
        'broad gh repo must NOT land (narrowed)',
      );
      assert.ok(
        !allow.includes('Bash(gh label *)'),
        'broad gh label must NOT land (narrowed)',
      );
    } catch {
      /* gh not installed — skip narrow-verb assertions */
    }
  } finally {
    cleanup(tmpDir);
  }
});

// ── ALLOW-16: install.js writes canonical forms + narrowed CLI verbs on win32 ──

test('ALLOW-16: install.js --local on win32 writes canonical glob forms and narrowed CLI verbs', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-allow-16-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, {
          HOME: os.homedir(),
          GSD_TEST_FORCE_PLATFORM: 'win32',
        }),
      },
    );
    assert.strictEqual(result.status, 0, `install.js failed: ${result.stderr}`);

    const settings = JSON.parse(
      fs.readFileSync(path.join(tmpDir, '.claude', 'settings.json'), 'utf8'),
    );
    const allow = settings.permissions?.allow ?? [];

    // Canonical forms present (win32 mirrors darwin per getReadEditWriteAllowRules)
    assert.ok(
      allow.includes('Edit(*)'),
      'win32 must include canonical Edit(*)',
    );
    assert.ok(
      allow.includes('Write(*)'),
      'win32 must include canonical Write(*)',
    );
    assert.ok(
      allow.includes('Read(*)'),
      'win32 must include canonical Read(*)',
    );

    // Bare forms absent
    assert.ok(!allow.includes('Edit'), 'win32 must NOT carry bare Edit');
    assert.ok(!allow.includes('Write'), 'win32 must NOT carry bare Write');
    assert.ok(!allow.includes('Read'), 'win32 must NOT carry bare Read');

    // Narrowed verbs land — gated on gh presence on host
    try {
      require('child_process').execSync('which gh', {
        stdio: 'ignore',
        timeout: 2000,
      });
      assert.ok(
        allow.includes('Bash(gh repo view *)'),
        'narrowed repo view must land',
      );
      assert.ok(
        allow.includes('Bash(gh label create *)'),
        'narrowed label create must land',
      );
      assert.ok(
        !allow.includes('Bash(gh repo *)'),
        'broad gh repo must NOT land (narrowed)',
      );
      assert.ok(
        !allow.includes('Bash(gh label *)'),
        'broad gh label must NOT land (narrowed)',
      );
    } catch {
      /* gh not installed — skip narrow-verb assertions */
    }
  } finally {
    cleanup(tmpDir);
  }
});

// ── ALLOW-09: allow section sync union preserves user entries + logs per-section count ──

test('ALLOW-09: allow-section sync preserves user entries and logs "Added N allow entries"', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-allow-09-'));
  try {
    const configDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify(
        { permissions: { allow: ['Bash(custom-cmd *)'] } },
        null,
        2,
      ),
    );

    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, {
          HOME: os.homedir(),
          GSD_TEST_FORCE_PLATFORM: 'darwin',
        }),
      },
    );
    assert.strictEqual(result.status, 0, `install.js failed: ${result.stderr}`);

    const settings = JSON.parse(
      fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'),
    );
    assert.ok(
      settings.permissions.allow.includes('Bash(custom-cmd *)'),
      'user entry must be preserved',
    );
    assert.ok(
      settings.permissions.allow.includes('Bash(node *)'),
      'template entries must be added',
    );
    assert.match(
      result.stdout,
      /Added \d+ allow entries/,
      'must log per-section allow count',
    );
    // Narrowed-verb check — gated on gh presence (ALLOW-22 integration)
    try {
      require('child_process').execSync('which gh', {
        stdio: 'ignore',
        timeout: 2000,
      });
      const allow = settings.permissions?.allow ?? [];
      assert.ok(
        !allow.includes('Bash(gh repo *)'),
        'linux install must not land broad gh repo (narrowed)',
      );
      assert.ok(
        allow.includes('Bash(gh repo view *)') || allow.length === 0,
        'narrowed repo view lands when gh present',
      );
    } catch {
      /* gh not installed */
    }
  } finally {
    cleanup(tmpDir);
  }
});

// ── ALLOW-10: deny section sync is no-op today (template has no deny block) ──

test('ALLOW-10: deny-section sync preserves user denies and does not log deny additions', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-allow-10-'));
  try {
    const configDir = path.join(tmpDir, '.claude');
    fs.mkdirSync(configDir, { recursive: true });
    fs.writeFileSync(
      path.join(configDir, 'settings.json'),
      JSON.stringify(
        { permissions: { allow: [], deny: ['Bash(user-deny *)'] } },
        null,
        2,
      ),
    );

    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, {
          HOME: os.homedir(),
          GSD_TEST_FORCE_PLATFORM: 'darwin',
        }),
      },
    );
    assert.strictEqual(result.status, 0);

    const settings = JSON.parse(
      fs.readFileSync(path.join(configDir, 'settings.json'), 'utf8'),
    );
    assert.ok(
      settings.permissions.deny.includes('Bash(user-deny *)'),
      'user deny must be preserved',
    );
    assert.doesNotMatch(
      result.stdout,
      /Added \d+ deny/,
      'no deny additions expected',
    );
  } finally {
    cleanup(tmpDir);
  }
});

// ── ALLOW-11: "up to date" only after all three sections return zero additions ──

test('ALLOW-11: second install logs "Permissions already up to date" (no per-section adds)', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-allow-11-'));
  try {
    const configDir = path.join(tmpDir, '.claude');
    const spawn = () =>
      spawnSync(
        process.execPath,
        [INSTALLER, '--runtime', 'claude', '--local'],
        {
          encoding: 'utf8',
          timeout: 15000,
          cwd: tmpDir,
          env: Object.assign({}, process.env, {
            HOME: os.homedir(),
            GSD_TEST_FORCE_PLATFORM: 'darwin',
          }),
        },
      );
    const first = spawn();
    assert.strictEqual(first.status, 0);
    const second = spawn();
    assert.strictEqual(second.status, 0);
    assert.match(second.stdout, /Permissions already up to date/);
    assert.doesNotMatch(second.stdout, /Added \d+ allow entries/);
  } finally {
    cleanup(tmpDir);
  }
});

// ── F-RULES-01: {{PROJECT_RULES_FILE}} must survive install (not collapsed to CLAUDE.md) ──
// TDD RED: currently collapsed to CLAUDE.md at install time in copyWithPathReplacement().
// Fix: remove the {{PROJECT_RULES_FILE}} -> CLAUDE.md substitution from install.js.

test('F-RULES-01: {{PROJECT_RULES_FILE}} template variable is NOT collapsed to CLAUDE.md in installed skill files (claude runtime)', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-frules-01-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime claude --local must exit 0 (F-RULES-01)\nstderr: ' +
        (result.stderr || ''),
    );

    // Check that seed-memories.md retains {{PROJECT_RULES_FILE}} after install
    // (it should NOT be collapsed to 'CLAUDE.md' at install time)
    const seedMemoriesPath = path.join(
      tmpDir,
      '.claude',
      'commands',
      'gsd',
      'seed-memories.md',
    );
    assert.ok(
      fs.existsSync(seedMemoriesPath),
      'commands/gsd/seed-memories.md must exist after claude install (F-RULES-01)',
    );
    const seedContent = fs.readFileSync(seedMemoriesPath, 'utf8');
    assert.ok(
      seedContent.includes('{{PROJECT_RULES_FILE}}'),
      'installed seed-memories.md must retain {{PROJECT_RULES_FILE}} template variable (F-RULES-01).\n' +
        'It was collapsed to CLAUDE.md at install time — remove that substitution from install.js.',
    );
  } finally {
    cleanup(tmpDir);
  }
});

test('F-RULES-02: {{PROJECT_RULES_FILE}} template variable is retained in installed workflow files (claude runtime)', () => {
  const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-frules-02-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--runtime', 'claude', '--local'],
      {
        encoding: 'utf8',
        timeout: 15000,
        cwd: tmpDir,
        env: Object.assign({}, process.env, { HOME: os.homedir() }),
      },
    );
    assert.strictEqual(
      result.status,
      0,
      'install.js --runtime claude --local must exit 0 (F-RULES-02)\nstderr: ' +
        (result.stderr || ''),
    );

    // Check new-project.md retains {{PROJECT_RULES_FILE}} after install
    const newProjectPath = path.join(
      tmpDir,
      '.claude',
      'gsd-ng',
      'workflows',
      'new-project.md',
    );
    assert.ok(
      fs.existsSync(newProjectPath),
      'gsd-ng/workflows/new-project.md must exist after claude install (F-RULES-02)',
    );
    const npContent = fs.readFileSync(newProjectPath, 'utf8');
    assert.ok(
      npContent.includes('{{PROJECT_RULES_FILE}}'),
      'installed new-project.md must retain {{PROJECT_RULES_FILE}} template variable (F-RULES-02).\n' +
        'It was collapsed to CLAUDE.md at install time — remove that substitution from install.js.',
    );
  } finally {
    cleanup(tmpDir);
  }
});
