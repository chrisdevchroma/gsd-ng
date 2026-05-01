'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');

test('SCAN-PATHS-01: ci-security-scan.cjs SCAN_PATHS set-equals security-scan.yml paths trigger', () => {
  // Read SCAN_PATHS from ci-security-scan.cjs
  const scanScript = fs.readFileSync(
    path.join(REPO_ROOT, 'scripts', 'ci-security-scan.cjs'),
    'utf8',
  );
  const match = scanScript.match(/const SCAN_PATHS\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, 'SCAN_PATHS constant must exist in ci-security-scan.cjs');
  const scanPaths = match[1]
    .split(',')
    .map((s) => s.trim().replace(/^['"]|['"]$/g, ''))
    .filter(Boolean);

  // Read paths: trigger from security-scan.yml
  const workflowYml = fs.readFileSync(
    path.join(REPO_ROOT, '.github', 'workflows', 'security-scan.yml'),
    'utf8',
  );
  const pathsBlock = workflowYml.match(/paths:\s*\n((?:\s+-\s+.+\n?)+)/);
  assert.ok(pathsBlock, 'security-scan.yml must have a paths: trigger block');
  const workflowPaths = pathsBlock[1]
    .split('\n')
    .map((l) => l.replace(/^\s+-\s+['"]?/, '').replace(/['"]?\s*$/, ''))
    .filter(Boolean)
    .map((p) => p.replace(/\/\*\*$/, '/')); // strip /** glob suffix

  const scanSet = new Set(scanPaths);
  const workflowSet = new Set(workflowPaths);

  for (const p of workflowSet) {
    assert.ok(
      scanSet.has(p),
      `SCAN_PATHS missing '${p}' (in security-scan.yml but not SCAN_PATHS)`,
    );
  }
  for (const p of scanSet) {
    assert.ok(
      workflowSet.has(p),
      `SCAN_PATHS has '${p}' not in security-scan.yml paths:`,
    );
  }
});
