'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { execSync } = require('child_process');
const { resolveTmpDir } = require('./helpers.cjs');

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

  // F-001: corrupt baseline file should produce a stderr warning
  await t.test('F-001: compareBaseline emits stderr warning when baseline file is corrupt JSON', () => {
    const tmpBase = resolveTmpDir();
    const tmpDir = fs.mkdtempSync(path.join(tmpBase, 'gsd-baseline-test-'));
    try {
      const corruptFile = path.join(tmpDir, 'corrupt-baseline.json');
      fs.writeFileSync(corruptFile, 'NOT_VALID_JSON{{{', 'utf-8');
      const { compareBaseline } = require('../gsd-ng/bin/lib/test-baseline.cjs');
      // Intercept stderr to verify warning is emitted
      const originalWrite = process.stderr.write.bind(process.stderr);
      const stderrChunks = [];
      process.stderr.write = (chunk) => { stderrChunks.push(String(chunk)); return true; };
      try {
        compareBaseline(JSON.stringify([{ dir: '.', command: 'echo ok' }]), corruptFile);
      } finally {
        process.stderr.write = originalWrite;
      }
      const stderrOutput = stderrChunks.join('');
      assert.ok(
        stderrOutput.includes('corrupt') || stderrOutput.includes('baseline') || stderrOutput.includes('parse'),
        `Expected a stderr warning about corrupt baseline file, got: ${stderrOutput}`,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
