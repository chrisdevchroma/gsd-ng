'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execSync } = require('child_process');

const GSD_TOOLS = path.join(__dirname, '..', 'gsd-ng', 'bin', 'gsd-tools.cjs');

test('test-baseline lib module', async (t) => {
  await t.test('exports captureBaseline function', () => {
    const mod = require('../gsd-ng/bin/lib/test-baseline.cjs');
    assert.equal(typeof mod.captureBaseline, 'function', 'captureBaseline should be a function');
  });

  await t.test('exports compareBaseline function', () => {
    const mod = require('../gsd-ng/bin/lib/test-baseline.cjs');
    assert.equal(typeof mod.compareBaseline, 'function', 'compareBaseline should be a function');
  });

  await t.test('gsd-tools test capture-baseline with no args produces Too few arguments error', () => {
    let output = '';
    try {
      execSync(`node "${GSD_TOOLS}" test capture-baseline`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      assert.fail('should have exited with error');
    } catch (err) {
      output = (err.stdout || '') + (err.stderr || '');
    }
    assert.ok(output.includes('Too few arguments'), `expected "Too few arguments" in output, got: ${output}`);
  });

  await t.test('gsd-tools test with unknown subcommand produces error', () => {
    let output = '';
    try {
      execSync(`node "${GSD_TOOLS}" test unknown-subcmd arg1 arg2`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] });
      assert.fail('should have exited with error');
    } catch (err) {
      output = (err.stdout || '') + (err.stderr || '');
    }
    assert.ok(output.includes('Unknown test subcommand') || output.includes('unknown-subcmd'), `expected error for unknown subcommand, got: ${output}`);
  });
});
