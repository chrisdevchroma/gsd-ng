/**
 * GSD Tools Tests - Ping-Pong Oscillation Detection
 *
 * Tests for cmdPingpongCheck, parseCommitLog, and detectOscillation functions.
 * These detect agent oscillation patterns in git history to prevent executor/verifier
 * loops from endlessly reverting each other's changes.
 */

'use strict';

const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { runGsdTools, createTempGitProject, cleanup } = require('./helpers.cjs');

// Direct require for unit testing internal helpers
const commands = require('../gsd-ng/bin/lib/commands.cjs');

// ─── Unit tests for parseCommitLog ───────────────────────────────────────────

describe('parseCommitLog', () => {
  test('parses single commit with no files', () => {
    const logOutput = 'abc1234|executor@gsd|feat(18-01): add feature\n';
    const commits = commands.parseCommitLog(logOutput);
    assert.strictEqual(commits.length, 1);
    assert.strictEqual(commits[0].hash, 'abc1234');
    assert.strictEqual(commits[0].author, 'executor@gsd');
    assert.strictEqual(commits[0].subject, 'feat(18-01): add feature');
    assert.deepStrictEqual(commits[0].files, []);
  });

  test('parses commit with changed files', () => {
    const logOutput = 'abc1234|executor@gsd|feat: add feature\nsrc/feature.js\nsrc/other.js\n';
    const commits = commands.parseCommitLog(logOutput);
    assert.strictEqual(commits.length, 1);
    assert.deepStrictEqual(commits[0].files, ['src/feature.js', 'src/other.js']);
  });

  test('parses multiple commits separated by blank lines', () => {
    const logOutput = [
      'aaa0001|executor@gsd|feat: add feature',
      'src/feature.js',
      '',
      'bbb0002|verifier@gsd|fix: revert feature',
      'src/feature.js',
      '',
    ].join('\n');
    const commits = commands.parseCommitLog(logOutput);
    assert.strictEqual(commits.length, 2);
    assert.strictEqual(commits[0].author, 'executor@gsd');
    assert.strictEqual(commits[1].author, 'verifier@gsd');
    assert.deepStrictEqual(commits[0].files, ['src/feature.js']);
    assert.deepStrictEqual(commits[1].files, ['src/feature.js']);
  });

  test('returns empty array for empty input', () => {
    assert.deepStrictEqual(commands.parseCommitLog(''), []);
    assert.deepStrictEqual(commands.parseCommitLog('  \n  \n'), []);
  });

  test('extracts hash, author, subject correctly', () => {
    const logOutput = 'deadbeef|agent-a@gsd.io|fix(auth): correct token validation\nauth/token.js\n';
    const commits = commands.parseCommitLog(logOutput);
    assert.strictEqual(commits[0].hash, 'deadbeef');
    assert.strictEqual(commits[0].author, 'agent-a@gsd.io');
    assert.strictEqual(commits[0].subject, 'fix(auth): correct token validation');
    assert.deepStrictEqual(commits[0].files, ['auth/token.js']);
  });
});

// ─── Unit tests for detectOscillation ────────────────────────────────────────

describe('detectOscillation', () => {
  test('returns ok for single-author commits on different files', () => {
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat: add A', files: ['src/a.js'] },
      { hash: 'a2', author: 'executor@gsd', subject: 'feat: add B', files: ['src/b.js'] },
      { hash: 'a3', author: 'executor@gsd', subject: 'feat: add C', files: ['src/c.js'] },
    ];
    const result = commands.detectOscillation(commits);
    assert.strictEqual(result.status, 'ok');
  });

  test('returns ok for single-author repeated modifications to same file', () => {
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat: v1', files: ['src/feature.js'] },
      { hash: 'a2', author: 'executor@gsd', subject: 'feat: v2', files: ['src/feature.js'] },
      { hash: 'a3', author: 'executor@gsd', subject: 'feat: v3', files: ['src/feature.js'] },
      { hash: 'a4', author: 'executor@gsd', subject: 'feat: v4', files: ['src/feature.js'] },
      { hash: 'a5', author: 'executor@gsd', subject: 'feat: v5', files: ['src/feature.js'] },
    ];
    const result = commands.detectOscillation(commits);
    assert.strictEqual(result.status, 'ok', 'Single-author iteration should not trigger warning');
  });

  test('returns warning when two different authors modify same file in alternating commits', () => {
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat: add feature', files: ['src/feature.js'] },
      { hash: 'b1', author: 'verifier@gsd', subject: 'fix: revert feature', files: ['src/feature.js'] },
    ];
    const result = commands.detectOscillation(commits);
    assert.strictEqual(result.status, 'warning');
    assert.ok(result.details.oscillating_files.includes('src/feature.js'), 'Should list oscillating file');
  });

  test('returns halt when same file shows 3+ modifications by alternating authors', () => {
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat: v1', files: ['src/feature.js'] },
      { hash: 'b1', author: 'verifier@gsd', subject: 'fix: revert', files: ['src/feature.js'] },
      { hash: 'a2', author: 'executor@gsd', subject: 'feat: v2', files: ['src/feature.js'] },
    ];
    const result = commands.detectOscillation(commits);
    assert.strictEqual(result.status, 'halt');
    assert.ok(result.details.oscillating_files.includes('src/feature.js'), 'Should list oscillating file');
  });

  test('returns details.oscillating_files listing conflicting files', () => {
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat: update', files: ['src/a.js', 'src/b.js'] },
      { hash: 'b1', author: 'verifier@gsd', subject: 'fix: revert', files: ['src/a.js'] },
    ];
    const result = commands.detectOscillation(commits);
    assert.ok(Array.isArray(result.details.oscillating_files), 'oscillating_files should be array');
    assert.ok(result.details.oscillating_files.includes('src/a.js'));
  });

  test('returns details.agent_sequence listing author pattern', () => {
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat: add', files: ['src/feature.js'] },
      { hash: 'b1', author: 'verifier@gsd', subject: 'fix: revert', files: ['src/feature.js'] },
    ];
    const result = commands.detectOscillation(commits);
    assert.ok(Array.isArray(result.details.agent_sequence), 'agent_sequence should be array');
    assert.ok(result.details.agent_sequence.length > 0, 'agent_sequence should not be empty');
  });

  test('returns ok for empty commits array', () => {
    const result = commands.detectOscillation([]);
    assert.strictEqual(result.status, 'ok');
  });

  test('only triggers on same-file alternation, not different files per author', () => {
    const commits = [
      { hash: 'a1', author: 'executor@gsd', subject: 'feat: add A', files: ['src/a.js'] },
      { hash: 'b1', author: 'verifier@gsd', subject: 'feat: add B', files: ['src/b.js'] },
      { hash: 'a2', author: 'executor@gsd', subject: 'feat: add C', files: ['src/c.js'] },
    ];
    const result = commands.detectOscillation(commits);
    assert.strictEqual(result.status, 'ok', 'Different files should not trigger oscillation');
  });
});

// ─── Integration tests for cmdPingpongCheck ───────────────────────────────────

describe('cmdPingpongCheck integration', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = createTempGitProject();
    // Create src/ directory for file modifications
    fs.mkdirSync(path.join(tmpDir, 'src'), { recursive: true });
  });

  afterEach(() => {
    cleanup(tmpDir);
  });

  test('Test 1: returns ok for single-author commit history', () => {
    // Add a few commits by the same author (using default test@test.com from createTempGitProject)
    fs.writeFileSync(path.join(tmpDir, 'src', 'feature.js'), 'v1');
    execSync('git add -A && git commit -m "feat: add feature"', { cwd: tmpDir, stdio: 'pipe' });
    fs.writeFileSync(path.join(tmpDir, 'src', 'feature.js'), 'v2');
    execSync('git add -A && git commit -m "feat: update feature"', { cwd: tmpDir, stdio: 'pipe' });

    const result = runGsdTools(['pingpong-check'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'ok');
  });

  test('Test 2: returns warning when two different authors modify same file in alternating commits', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'feature.js'), 'v1');
    execSync(
      'git add -A && git commit --author="executor@gsd <executor@gsd>" -m "feat: add feature"',
      { cwd: tmpDir, stdio: 'pipe' }
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'feature.js'), 'v2');
    execSync(
      'git add -A && git commit --author="verifier@gsd <verifier@gsd>" -m "fix: revert feature"',
      { cwd: tmpDir, stdio: 'pipe' }
    );

    const result = runGsdTools(['pingpong-check'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'warning', `Expected warning, got: ${JSON.stringify(parsed)}`);
    assert.ok(parsed.details && Array.isArray(parsed.details.oscillating_files));
  });

  test('Test 3: returns halt when same file has 3+ alternating author modifications', () => {
    fs.writeFileSync(path.join(tmpDir, 'src', 'feature.js'), 'v1');
    execSync(
      'git add -A && git commit --author="executor@gsd <executor@gsd>" -m "feat: add feature"',
      { cwd: tmpDir, stdio: 'pipe' }
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'feature.js'), 'v2');
    execSync(
      'git add -A && git commit --author="verifier@gsd <verifier@gsd>" -m "fix: revert feature"',
      { cwd: tmpDir, stdio: 'pipe' }
    );
    fs.writeFileSync(path.join(tmpDir, 'src', 'feature.js'), 'v3');
    execSync(
      'git add -A && git commit --author="executor@gsd <executor@gsd>" -m "feat: re-add feature"',
      { cwd: tmpDir, stdio: 'pipe' }
    );

    const result = runGsdTools(['pingpong-check'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'halt', `Expected halt, got: ${JSON.stringify(parsed)}`);
  });

  test('Test 4: returns ok when single author modifies same file 5 times (iteration, not oscillation)', () => {
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(path.join(tmpDir, 'src', 'feature.js'), `v${i}`);
      execSync(
        `git add -A && git commit --author="executor@gsd <executor@gsd>" -m "feat: update v${i}"`,
        { cwd: tmpDir, stdio: 'pipe' }
      );
    }

    const result = runGsdTools(['pingpong-check'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'ok', 'Single-author iteration should not trigger warning');
  });

  test('Test 5: returns ok when no additional git history (fresh repo with initial commit only)', () => {
    // createTempGitProject already made initial commit, but no multi-author oscillation
    const result = runGsdTools(['pingpong-check'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    const parsed = JSON.parse(result.output);
    assert.strictEqual(parsed.status, 'ok');
  });

  test('CLI integration: gsd-tools pingpong-check runs and returns valid JSON', () => {
    const result = runGsdTools(['pingpong-check'], tmpDir);
    assert.ok(result.success, `Command failed: ${result.error}`);
    // Must be valid JSON
    let parsed;
    assert.doesNotThrow(() => {
      parsed = JSON.parse(result.output);
    }, 'Output must be valid JSON');
    // Must have status field
    assert.ok(parsed.status, 'Result must have status field');
    assert.ok(['ok', 'warning', 'halt'].includes(parsed.status), `Status must be ok/warning/halt, got: ${parsed.status}`);
  });
});
