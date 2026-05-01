#!/usr/bin/env node
// run-actionlint.cjs — runs actionlint against all workflow YAML files.
// Looks for actionlint on PATH first, then falls back to .bin/actionlint.
// If neither is available, warns and skips (graceful local skip).
// In CI (CI=true), unavailability is a hard failure.
'use strict';

const { execFileSync, execSync } = require('child_process');
const { existsSync, readdirSync } = require('fs');
const { join } = require('path');

const ROOT = join(__dirname, '..');
const VENDORED = join(ROOT, '.bin', 'actionlint');
const WORKFLOWS_DIR = join(ROOT, '.github', 'workflows');

function findActionlint() {
  // 1. Check PATH
  try {
    execSync('actionlint --version', { stdio: 'ignore' });
    return 'actionlint';
  } catch {
    // not on PATH
  }
  // 2. Check vendored binary
  if (existsSync(VENDORED)) {
    return VENDORED;
  }
  return null;
}

const bin = findActionlint();

if (!bin) {
  const msg =
    'actionlint not found (not on PATH and no .bin/actionlint vendored).\n' +
    'To install: download from https://github.com/rhysd/actionlint/releases\n' +
    '  Linux/macOS: place binary at gsd-ng/.bin/actionlint and chmod +x\n' +
    '  Or: brew install actionlint';
  if (process.env.CI === 'true') {
    console.error('ERROR: ' + msg);
    process.exit(1);
  } else {
    console.warn('WARNING: ' + msg);
    console.warn('Skipping actionlint check (CI=false).');
    process.exit(0);
  }
}

// Collect workflow files
const workflowFiles = readdirSync(WORKFLOWS_DIR)
  .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
  .map((f) => join(WORKFLOWS_DIR, f));

if (workflowFiles.length === 0) {
  console.error('No workflow YAML files found under .github/workflows/');
  process.exit(1);
}

console.log(
  `Running actionlint (${bin}) against ${workflowFiles.length} workflow file(s)...`,
);

try {
  execFileSync(bin, workflowFiles, { stdio: 'inherit' });
  console.log('actionlint: all workflow files passed.');
} catch (err) {
  // actionlint exits non-zero when there are errors
  process.exit(err.status || 1);
}
