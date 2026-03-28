#!/usr/bin/env node
'use strict';

/**
 * Compare pre-UAT test results against captured baseline.
 *
 * Usage: node compare-test-baseline.cjs '<discovered_json>' '<baseline_file>'
 *
 * Re-runs discovered test commands, compares against baseline, emits GSD banner
 * table with NEW_FAILURES detection and test count diff.
 *
 * Extracted from execute-phase.md inline node -e script.
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const entries = JSON.parse(process.argv[2]);
const baselineFile = process.argv[3];
const cwd = process.cwd();
let baselines = {};
try { baselines = JSON.parse(fs.readFileSync(baselineFile, 'utf-8')); } catch {}

const results = [];
let hasNewFailure = false;

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

  const baseline = baselines[dir] || { exit_code: -1 };
  const baselineStatus = baseline.exit_code === 0 ? 'pass' : (baseline.exit_code === -1 ? 'none' : 'fail');
  const postStatus = exitCode === 0 ? 'pass' : 'fail';
  const isNew = postStatus === 'fail' && baselineStatus !== 'fail';
  if (isNew) hasNewFailure = true;

  // Parse post-run count from TAP output
  const postTestsMatch = output.match(/^# tests (\d+)/m);
  const postTests = postTestsMatch ? parseInt(postTestsMatch[1]) : null;
  const baselineTests = baseline.tests;
  const countDiff = (baselineTests != null && postTests != null) ? (postTests - baselineTests) : null;

  results.push({ dir, command, baseline: baselineStatus, post: postStatus, isNew, output: output.slice(-2000), baselineTests, postTests, countDiff });
}

// Emit GSD banner
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(' GSD ► TEST RESULTS');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('');

// Table header
const pad = (s, n) => s.padEnd(n);
const maxDir = Math.max(10, ...results.map(r => r.dir.length));
const maxCmd = Math.max(8, ...results.map(r => r.command.length));
console.log('| ' + pad('Directory', maxDir) + ' | ' + pad('Command', maxCmd) + ' | Baseline | Pre-UAT  |');
console.log('|' + '-'.repeat(maxDir + 2) + '|' + '-'.repeat(maxCmd + 2) + '|----------|----------|');
for (const r of results) {
  const bMark = r.baseline === 'pass' ? '✓ pass' : (r.baseline === 'none' ? '- none' : '✗ fail');
  const pMark = r.post === 'pass' ? '✓ pass' : '✗ fail';
  console.log('| ' + pad(r.dir, maxDir) + ' | ' + pad(r.command, maxCmd) + ' | ' + pad(bMark, 8) + ' | ' + pad(pMark, 8) + ' |');
}

const passing = results.filter(r => r.post === 'pass').length;
const preExisting = results.filter(r => r.post === 'fail' && !r.isNew).length;
console.log('');
console.log('Overall: ' + passing + '/' + results.length + ' passing' + (preExisting > 0 ? '  (pre-existing failures: ' + preExisting + ')' : ''));

// Display test count changes (only when count data available)
for (const r of results) {
  if (r.countDiff !== null) {
    if (r.countDiff > 0) {
      console.log('Tests: ' + r.baselineTests + ' → ' + r.postTests + ' (+' + r.countDiff + ')');
    } else if (r.countDiff < 0) {
      console.log('Tests: ' + r.baselineTests + ' → ' + r.postTests + ' (' + r.countDiff + ' ⚠ count dropped)');
    }
    // countDiff === 0: no output (unchanged, expected case)
  }
}
console.log('');

// Output summary for triage decision
if (hasNewFailure) {
  console.log('NEW_FAILURES=true');
  for (const r of results.filter(x => x.isNew)) {
    console.log('');
    console.log('New failure in ' + r.dir + ':');
    console.log(r.output);
  }
} else {
  console.log('NEW_FAILURES=false');
}
