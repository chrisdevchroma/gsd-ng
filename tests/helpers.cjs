/**
 * GSD Tools Test Helpers
 */

const { execSync, execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const TOOLS_PATH = path.join(__dirname, '..', 'gsd-ng', 'bin', 'gsd-tools.cjs');

/**
 * Run gsd-tools command.
 *
 * @param {string|string[]} args - Command string (shell-interpreted) or array
 *   of arguments (shell-bypassed via execFileSync, safe for JSON and dollar signs).
 * @param {string} cwd - Working directory.
 * @param {object} envOverrides - Extra env vars merged on top of process.env (default: {}).
 */
function runGsdTools(args, cwd = process.cwd(), envOverrides = {}) {
  try {
    let result;
    const env = { ...process.env, ...envOverrides };
    if (Array.isArray(args)) {
      result = execFileSync(process.execPath, [TOOLS_PATH, ...args], {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
    } else {
      result = execSync(`node "${TOOLS_PATH}" ${args}`, {
        cwd,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env,
      });
    }
    return { success: true, output: result.trim() };
  } catch (err) {
    return {
      success: false,
      output: err.stdout?.toString().trim() || '',
      error: err.stderr?.toString().trim() || err.message,
    };
  }
}

// Resolve a writable temp base dir — os.tmpdir() may point to /tmp/claude which doesn't
// exist in the Claude Code sandbox. Fall back through known-writable candidates.
function resolveTmpDir() {
  const candidates = [process.env.TMPDIR, os.tmpdir(), '/tmp/claude-1000', '/tmp'].filter(Boolean);
  for (const dir of candidates) {
    try { if (fs.existsSync(dir)) return dir; } catch {}
  }
  return os.tmpdir(); // last resort
}

// Create temp directory structure
function createTempProject() {
  const tmpDir = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });
  return tmpDir;
}

// Create temp directory with initialized git repo and at least one commit
function createTempGitProject() {
  const tmpDir = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-test-'));
  fs.mkdirSync(path.join(tmpDir, '.planning', 'phases'), { recursive: true });

  execSync('git init', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git config commit.gpgsign false', { cwd: tmpDir, stdio: 'pipe' });

  fs.writeFileSync(
    path.join(tmpDir, '.planning', 'PROJECT.md'),
    '# Project\n\nTest project.\n'
  );

  execSync('git add -A', { cwd: tmpDir, stdio: 'pipe' });
  execSync('git commit -m "initial commit"', { cwd: tmpDir, stdio: 'pipe' });

  return tmpDir;
}

function cleanup(tmpDir) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}

module.exports = { runGsdTools, createTempProject, createTempGitProject, cleanup, resolveTmpDir, TOOLS_PATH };
