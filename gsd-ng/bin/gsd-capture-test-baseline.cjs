#!/usr/bin/env node
'use strict';

/**
 * Capture test baselines — run discovered test commands and record TAP summary.
 *
 * Usage: node capture-test-baseline.cjs '<discovered_json>' '<output_file>'
 *
 * Extracted from execute-phase.md inline node -e script.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const entries = JSON.parse(process.argv[2]);
const outputFile = process.argv[3];
const cwd = process.cwd();
const baselines = {};

for (const { dir, command } of entries) {
  const runDir = dir === '.' ? cwd : path.join(cwd, dir);
  let exitCode = 0;
  let output = '';
  try {
    output = execSync(command, { cwd: runDir, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 120000 });
  } catch (err) {
    exitCode = err.status || 1;
    output = (err.stdout || '') + (err.stderr || '');
  }
  // Extract TAP summary lines (e.g., "# tests 1089", "# pass 1089", "# fail 0")
  const testsMatch = output.match(/^# tests (\d+)/m);
  const passMatch = output.match(/^# pass (\d+)/m);
  const failMatch = output.match(/^# fail (\d+)/m);
  baselines[dir] = {
    captured: new Date().toISOString(),
    command: command,
    exit_code: exitCode,
    tests: testsMatch ? parseInt(testsMatch[1]) : null,
    pass: passMatch ? parseInt(passMatch[1]) : null,
    fail: failMatch ? parseInt(failMatch[1]) : null
  };
  const status = exitCode === 0 ? 'passing' : 'failing (pre-existing)';
  console.log('  ' + dir + ': ' + status);
}

fs.writeFileSync(outputFile, JSON.stringify(baselines, null, 2));
