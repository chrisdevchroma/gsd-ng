'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const BUILD_SCRIPT = path.join(ROOT, 'scripts', 'build-tarball.js');
const EXPECTED_TARBALL = path.join(ROOT, 'dist', 'gsd-ng.tar.gz');

// ── build-tarball.js exits 0 and produces a .tar.gz file ────────────

test('DIST-01: node scripts/build-tarball.js exits 0 and produces gsd-ng.tar.gz', () => {
  // Remove any existing tarball so we verify fresh creation
  if (fs.existsSync(EXPECTED_TARBALL)) {
    fs.rmSync(EXPECTED_TARBALL);
  }

  const result = spawnSync(process.execPath, [BUILD_SCRIPT], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 30000,
  });

  assert.strictEqual(
    result.status,
    0,
    'build-tarball.js must exit 0 (DIST-01). stderr: ' + (result.stderr || '')
  );

  assert.ok(
    fs.existsSync(EXPECTED_TARBALL),
    'dist/gsd-ng.tar.gz must exist after build (DIST-01)'
  );

  const stats = fs.statSync(EXPECTED_TARBALL);
  assert.ok(
    stats.size > 0,
    'dist/gsd-ng.tar.gz must not be empty (DIST-01)'
  );
});
