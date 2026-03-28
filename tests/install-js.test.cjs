'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const INSTALLER = path.resolve(__dirname, '..', 'bin', 'install.js');

// ── TILDE-01: global install uses tilde paths, not absolute home dir ──────────

test('TILDE-01: install.js global install uses tilde paths in workflow files (no PII leak)', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-js-tilde-'));
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

    assert.strictEqual(
      result.status,
      0,
      'install.js --global must exit 0 (TILDE-01)\nstderr: ' + (result.stderr || '')
    );

    const workflowsDir = path.join(tmpDir, '.claude', 'get-shit-done', 'workflows');
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── UNINSTALL-01: banner shows Mode: Uninstall in uninstall mode ──────────────

test('UNINSTALL-01: install.js --uninstall shows Mode: Uninstall indicator in output', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-js-uninstall-'));
  try {
    const result = spawnSync(
      process.execPath,
      [INSTALLER, '--global', '--uninstall', '--config-dir', path.join(tmpDir, '.claude')],
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── PATH-03: local install produces $CLAUDE_PROJECT_DIR paths, not $HOME ──────

test('PATH-03: install.js local install uses $CLAUDE_PROJECT_DIR in workflow bash blocks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-js-path-local-'));
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

    // Non-interactive: exit 0 expected
    assert.strictEqual(
      result.status,
      0,
      'install.js --local must exit 0 (PATH-03)\nstderr: ' + (result.stderr || '')
    );

    const workflowsDir = path.join(tmpDir, '.claude', 'get-shit-done', 'workflows');
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// ── PATH-04: local install must not produce ./.claude/ relative paths ─────────

test('PATH-04: install.js local install must not produce ./.claude/ paths in bash code blocks', () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gsd-js-no-rel-'));
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
    assert.strictEqual(result.status, 0, 'install.js --local must exit 0');

    const workflowsDir = path.join(tmpDir, '.claude', 'get-shit-done', 'workflows');
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
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
