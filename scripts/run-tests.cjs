#!/usr/bin/env node
// Test runner — resolves test file globs via Node instead of shell expansion.
// Propagates NODE_V8_COVERAGE so c8 collects coverage from the child process.
'use strict';

const { readdirSync } = require('fs');
const { join } = require('path');
const { execFileSync } = require('child_process');

// --- format:check gate (runs before tests; fail fast on style drift) ---
const prettierBin = join(__dirname, '..', 'node_modules', '.bin', 'prettier');
try {
  execFileSync(
    prettierBin,
    ['--check', 'gsd-ng/**/*.{js,cjs}', 'bin/**/*.{js,cjs}'],
    { stdio: 'inherit' },
  );
} catch (err) {
  process.exit(err.status || 1);
}

// --- test runner ---
const testDir = join(__dirname, '..', 'tests');
const files = readdirSync(testDir)
  .filter(f => f.endsWith('.test.cjs'))
  .sort()
  .map(f => join('tests', f));

if (files.length === 0) {
  console.error('No test files found in tests/');
  process.exit(1);
}

try {
  execFileSync(process.execPath, ['--test', ...files], {
    stdio: 'inherit',
    env: { ...process.env },
  });
} catch (err) {
  process.exit(err.status || 1);
}
