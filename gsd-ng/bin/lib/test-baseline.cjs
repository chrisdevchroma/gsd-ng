'use strict';

/**
 * Test baseline capture and comparison utilities.
 *
 * Extracted from standalone gsd-capture-test-baseline.cjs and
 * gsd-compare-test-baseline.cjs scripts. Wired as gsd-tools subcommands:
 *   gsd-tools test capture-baseline <entriesJson> <outputFile>
 *   gsd-tools test compare-baseline <entriesJson> <baselineFile>
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { StringDecoder } = require('string_decoder');

// Must stay distinct from 0 and from any real non-zero exit: compareBaseline
// treats a 'fail' baseline as licence to suppress new-failure detection.
const TIMEOUT_EXIT_CODE = -2;

const DEFAULT_TIMEOUT_MS = 600000;
const READ_CHUNK_SIZE = 64 * 1024;
const MAX_SUMMARY_LINE = 256;
const FAILURE_TAIL_SIZE = 2000;
const SPOOL_PREFIX = 'gsd-test-baseline-';

function resolveTimeoutMs() {
  const raw = process.env.GSD_TEST_TIMEOUT_MS;
  if (!raw) return DEFAULT_TIMEOUT_MS;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TIMEOUT_MS;
}

function closeQuietly(fd) {
  try {
    fs.closeSync(fd);
  } catch {}
}

function removeQuietly(dir) {
  try {
    fs.rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function scanSpool(spoolFile) {
  const summary = { tests: null, pass: null, fail: null };
  const readBuffer = Buffer.allocUnsafe(READ_CHUNK_SIZE);
  const decoder = new StringDecoder('utf8');
  const readFd = fs.openSync(spoolFile, 'r');
  let candidate = '';
  let discardingLine = false;
  let tail = '';

  function appendCandidate(fragment) {
    if (discardingLine) return;
    if (candidate.length + fragment.length > MAX_SUMMARY_LINE) {
      candidate = '';
      discardingLine = true;
      return;
    }
    candidate += fragment;
  }

  function finishLine() {
    if (!discardingLine) {
      const match = candidate.match(/^# (tests|pass|fail) (\d+)/);
      if (match) summary[match[1]] = parseInt(match[2], 10);
    }
    candidate = '';
    discardingLine = false;
  }

  function consume(text) {
    tail = (tail + text).slice(-FAILURE_TAIL_SIZE);
    let start = 0;
    for (let index = text.indexOf('\n'); index !== -1;) {
      appendCandidate(text.slice(start, index));
      finishLine();
      start = index + 1;
      index = text.indexOf('\n', start);
    }
    appendCandidate(text.slice(start));
  }

  try {
    let bytesRead;
    while (
      (bytesRead = fs.readSync(
        readFd,
        readBuffer,
        0,
        readBuffer.length,
        null,
      )) > 0
    ) {
      consume(decoder.write(readBuffer.subarray(0, bytesRead)));
    }
    consume(decoder.end());
    if (candidate.length > 0 && !discardingLine) finishLine();
    return { ...summary, tail };
  } finally {
    closeQuietly(readFd);
  }
}

/**
 * Run one test command, distinguishing "exited non-zero" from "never exited".
 *
 * @returns {{exitCode: number, summary: {tests: number|null, pass: number|null, fail: number|null}, tail: string, timedOut: boolean}}
 */
function runTestCommand(command, runDir) {
  const spoolDir = fs.mkdtempSync(path.join(os.tmpdir(), SPOOL_PREFIX));
  try {
    const spoolFile = path.join(spoolDir, 'output.log');
    const writeFd = fs.openSync(spoolFile, 'w');
    let result;
    try {
      result = spawnSync(command, {
        cwd: runDir,
        shell: true,
        stdio: ['ignore', writeFd, writeFd],
        timeout: resolveTimeoutMs(),
      });
    } finally {
      closeQuietly(writeFd);
    }

    const summary = scanSpool(spoolFile);
    const timedOut =
      result.error?.code === 'ETIMEDOUT' ||
      (result.signal === 'SIGTERM' && result.status == null);
    const exitCode = timedOut
      ? TIMEOUT_EXIT_CODE
      : Number.isInteger(result.status)
        ? result.status
        : 1;
    return {
      exitCode,
      summary,
      tail: summary.tail,
      timedOut,
    };
  } finally {
    removeQuietly(spoolDir);
  }
}

/**
 * Capture test baselines — run discovered test commands and record TAP summary.
 *
 * @param {string} entriesJson - JSON string of test entries: [{dir, command}]
 * @param {string} outputFile  - File path to write baseline JSON to
 */
function captureBaseline(entriesJson, outputFile) {
  const entries = JSON.parse(entriesJson);
  const cwd = process.cwd();
  const baselines = {};

  for (const { dir, command } of entries) {
    const runDir = dir === '.' ? cwd : path.join(cwd, dir);
    const { exitCode, summary, timedOut } = runTestCommand(command, runDir);
    baselines[dir] = {
      captured: new Date().toISOString(),
      command: command,
      exit_code: exitCode,
      tests: summary.tests,
      pass: summary.pass,
      fail: summary.fail,
    };
    const status = timedOut
      ? 'unknown (timed out — recorded as unknown, not as failing)'
      : exitCode === 0
        ? 'passing'
        : 'failing (pre-existing)';
    process.stderr.write('  ' + dir + ': ' + status + '\n');
  }

  fs.writeFileSync(outputFile, JSON.stringify(baselines, null, 2));
}

/**
 * Compare pre-UAT test results against captured baseline.
 *
 * Re-runs discovered test commands, compares against baseline, emits GSD banner
 * table with NEW_FAILURES detection and test count diff.
 *
 * @param {string} entriesJson   - JSON string of test entries: [{dir, command}]
 * @param {string} baselineFile  - File path to read baseline JSON from
 */
function compareBaseline(entriesJson, baselineFile) {
  const entries = JSON.parse(entriesJson);
  const cwd = process.cwd();
  let baselines = {};
  try {
    baselines = JSON.parse(fs.readFileSync(baselineFile, 'utf-8'));
  } catch (err) {
    process.stderr.write(
      `[gsd] Warning: could not parse baseline file '${baselineFile}': ${err.message}\n`,
    );
  }

  const results = [];
  let hasNewFailure = false;

  for (const { dir, command } of entries) {
    const runDir = dir === '.' ? cwd : path.join(cwd, dir);
    const { exitCode, summary, tail, timedOut } = runTestCommand(
      command,
      runDir,
    );

    const baseline = baselines[dir] || { exit_code: -1 };
    const baselineStatus =
      baseline.exit_code === 0
        ? 'pass'
        : baseline.exit_code === -1
          ? 'none'
          : baseline.exit_code === TIMEOUT_EXIT_CODE
            ? 'unknown'
            : 'fail';
    const postStatus = exitCode === 0 ? 'pass' : 'fail';
    const isNew = postStatus === 'fail' && baselineStatus !== 'fail';
    if (isNew) hasNewFailure = true;

    const postTests = summary.tests;
    const baselineTests = baseline.tests;
    const countDiff =
      baselineTests != null && postTests != null
        ? postTests - baselineTests
        : null;

    results.push({
      dir,
      command,
      baseline: baselineStatus,
      post: postStatus,
      isNew,
      timedOut,
      output: tail,
      baselineTests,
      postTests,
      countDiff,
    });
  }

  // Emit GSD banner
  console.log('');
  console.log('\u2501'.repeat(53));
  console.log(' GSD \u25ba TEST RESULTS');
  console.log('\u2501'.repeat(53));
  console.log('');

  // Table header
  const pad = (s, n) => s.padEnd(n);
  const maxDir = Math.max(10, ...results.map((r) => r.dir.length));
  const maxCmd = Math.max(8, ...results.map((r) => r.command.length));
  console.log(
    '| ' +
      pad('Directory', maxDir) +
      ' | ' +
      pad('Command', maxCmd) +
      ' | Baseline  | Pre-UAT  |',
  );
  console.log(
    '|' +
      '-'.repeat(maxDir + 2) +
      '|' +
      '-'.repeat(maxCmd + 2) +
      '|-----------|----------|',
  );
  for (const r of results) {
    const bMark =
      r.baseline === 'pass'
        ? '\u2713 pass'
        : r.baseline === 'none'
          ? '- none'
          : r.baseline === 'unknown'
            ? '? unknown'
            : '\u2717 fail';
    const pMark = r.timedOut
      ? '\u2717 t/out'
      : r.post === 'pass'
        ? '\u2713 pass'
        : '\u2717 fail';
    console.log(
      '| ' +
        pad(r.dir, maxDir) +
        ' | ' +
        pad(r.command, maxCmd) +
        ' | ' +
        pad(bMark, 9) +
        ' | ' +
        pad(pMark, 8) +
        ' |',
    );
  }

  const passing = results.filter((r) => r.post === 'pass').length;
  const preExisting = results.filter(
    (r) => r.post === 'fail' && !r.isNew,
  ).length;
  console.log('');
  console.log(
    'Overall: ' +
      passing +
      '/' +
      results.length +
      ' passing' +
      (preExisting > 0 ? '  (pre-existing failures: ' + preExisting + ')' : ''),
  );

  // Display test count changes (only when count data available)
  for (const r of results) {
    if (r.countDiff !== null) {
      if (r.countDiff > 0) {
        console.log(
          'Tests: ' +
            r.baselineTests +
            ' \u2192 ' +
            r.postTests +
            ' (+' +
            r.countDiff +
            ')',
        );
      } else if (r.countDiff < 0) {
        console.log(
          'Tests: ' +
            r.baselineTests +
            ' \u2192 ' +
            r.postTests +
            ' (' +
            r.countDiff +
            ' \u26a0 count dropped)',
        );
      }
      // countDiff === 0: no output (unchanged, expected case)
    }
  }
  console.log('');

  // Output summary for triage decision
  if (hasNewFailure) {
    console.log('NEW_FAILURES=true');
    for (const r of results.filter((x) => x.isNew)) {
      console.log('');
      if (r.timedOut) {
        console.log(
          'Timed out in ' +
            r.dir +
            ' — the suite did not finish, so this is not a verdict. ' +
            'Raise GSD_TEST_TIMEOUT_MS and re-run before triaging it as a regression.',
        );
      } else {
        console.log('New failure in ' + r.dir + ':');
      }
      console.log(r.output);
    }
  } else {
    console.log('NEW_FAILURES=false');
  }
}

module.exports = { captureBaseline, compareBaseline };
