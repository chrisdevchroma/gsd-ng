#!/usr/bin/env node
'use strict';

/**
 * GSD Benchmark Results Comparison Tool
 *
 * Compares two benchmark result JSON files and detects regressions.
 * Follows the gsd-compare-test-baseline.cjs pattern.
 *
 * Usage:
 *   node benchmarks/benchmark-compare.cjs <baseline.json> <current.json>
 *
 * Exit codes:
 *   0 — No regressions found
 *   1 — One or more regressions detected (baseline pass -> current fail)
 *
 * Output format:
 *   === Benchmark Comparison ===
 *   REGRESSIONS (N):   task+model combos that went from pass to fail
 *   IMPROVEMENTS (N):  task+model combos that went from fail to pass
 *   UNCHANGED: N/M     same pass/fail status
 *   DURATION CHANGES:  >10% duration deltas
 */

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);

  if (args.length < 2 || args.includes('--help')) {
    process.stdout.write([
      'Usage: node benchmarks/benchmark-compare.cjs <baseline.json> <current.json>',
      '',
      'Compares two benchmark result JSON files and detects regressions.',
      'Exit 0 = no regressions, Exit 1 = regressions found.',
    ].join('\n') + '\n');
    process.exit(args.length < 2 ? 1 : 0);
  }

  const [baselinePath, currentPath] = args;

  // Load both files
  let baseline, current;
  try {
    baseline = JSON.parse(fs.readFileSync(path.resolve(baselinePath), 'utf-8'));
  } catch (e) {
    process.stderr.write(`ERROR: Cannot read baseline file: ${baselinePath}\n  ${e.message}\n`);
    process.exit(1);
  }
  try {
    current = JSON.parse(fs.readFileSync(path.resolve(currentPath), 'utf-8'));
  } catch (e) {
    process.stderr.write(`ERROR: Cannot read current file: ${currentPath}\n  ${e.message}\n`);
    process.exit(1);
  }

  const report = compareResults(baseline, current);
  printReport(report, baselinePath, currentPath);

  process.exit(report.regressions.length > 0 ? 1 : 0);
}

// ---------------------------------------------------------------------------
// Core comparison logic
// ---------------------------------------------------------------------------

/**
 * Compare two result JSON objects and build a comparison report.
 *
 * @param {object} baseline - Parsed baseline results JSON
 * @param {object} current - Parsed current results JSON
 * @returns {object} Report with regressions, improvements, unchanged, added, removed, durationChanges
 */
function compareResults(baseline, current) {
  const regressions = [];     // baseline pass + current fail
  const improvements = [];    // baseline fail + current pass
  const unchanged = [];       // same pass/fail status
  const added = [];           // task+model in current but not baseline
  const removed = [];         // task+model in baseline but not current
  const durationChanges = []; // >10% duration change

  const baselineTasks = baseline.tasks || {};
  const currentTasks = current.tasks || {};

  // Union of all task IDs
  const allTaskIds = new Set([...Object.keys(baselineTasks), ...Object.keys(currentTasks)]);

  for (const taskId of allTaskIds) {
    const baselineTask = baselineTasks[taskId] || {};
    const currentTask = currentTasks[taskId] || {};

    // Union of all model IDs for this task
    const allModelIds = new Set([...Object.keys(baselineTask), ...Object.keys(currentTask)]);

    for (const modelId of allModelIds) {
      const bResult = baselineTask[modelId];
      const cResult = currentTask[modelId];

      if (bResult === undefined && cResult !== undefined) {
        added.push({ taskId, modelId, current: cResult });
        continue;
      }
      if (bResult !== undefined && cResult === undefined) {
        removed.push({ taskId, modelId, baseline: bResult });
        continue;
      }

      const bPass = bResult.pass === true;
      const cPass = cResult.pass === true;

      const entry = {
        taskId,
        modelId,
        baselinePass: bPass,
        currentPass: cPass,
        baselineDurationMs: bResult.duration_ms || null,
        currentDurationMs: cResult.duration_ms || null,
      };

      if (bPass && !cPass) {
        regressions.push({
          ...entry,
          baselineDetails: {
            format_compliance: bResult.format_compliance,
            completeness: bResult.completeness,
            correctness: bResult.correctness,
          },
          currentDetails: {
            format_compliance: cResult.format_compliance,
            completeness: cResult.completeness,
            correctness: cResult.correctness,
          },
        });
      } else if (!bPass && cPass) {
        improvements.push(entry);
      } else {
        unchanged.push(entry);
      }

      // Check duration change (only when both have duration data)
      if (entry.baselineDurationMs && entry.currentDurationMs) {
        const pctChange = ((entry.currentDurationMs - entry.baselineDurationMs) / entry.baselineDurationMs) * 100;
        if (Math.abs(pctChange) >= 10) {
          durationChanges.push({
            taskId,
            modelId,
            baselineDurationMs: entry.baselineDurationMs,
            currentDurationMs: entry.currentDurationMs,
            pctChange: pctChange.toFixed(1),
          });
        }
      }
    }
  }

  const totalCompared = regressions.length + improvements.length + unchanged.length;

  return {
    regressions,
    improvements,
    unchanged,
    added,
    removed,
    durationChanges,
    totalCompared,
    baselineInfo: {
      taskCount: Object.keys(baselineTasks).length,
      modelCount: (baseline.models || []).length,
      captured: baseline.captured || null,
    },
    currentInfo: {
      taskCount: Object.keys(currentTasks).length,
      modelCount: (current.models || []).length,
      captured: current.captured || null,
    },
  };
}

// ---------------------------------------------------------------------------
// Report printing
// ---------------------------------------------------------------------------

/**
 * Print a human-readable comparison report to stdout.
 * @param {object} report - Report from compareResults()
 * @param {string} baselinePath - Path label for baseline file
 * @param {string} currentPath - Path label for current file
 */
function printReport(report, baselinePath, currentPath) {
  const { regressions, improvements, unchanged, added, removed, durationChanges, totalCompared } = report;

  const baselineLabel = path.basename(baselinePath);
  const currentLabel = path.basename(currentPath);

  const pad = (s, n) => String(s).padEnd(n);

  process.stdout.write('\n=== Benchmark Comparison ===\n');
  process.stdout.write(`Baseline: ${baselineLabel} (${report.baselineInfo.taskCount} tasks, ${report.baselineInfo.modelCount} models)\n`);
  process.stdout.write(`Current:  ${currentLabel} (${report.currentInfo.taskCount} tasks, ${report.currentInfo.modelCount} models)\n\n`);

  // Regressions
  process.stdout.write(`REGRESSIONS (${regressions.length}):\n`);
  if (regressions.length === 0) {
    process.stdout.write('  (none)\n');
  } else {
    for (const r of regressions) {
      const details = formatDimChanges(r.baselineDetails, r.currentDetails);
      process.stdout.write(`  ${r.taskId} / ${r.modelId}: PASS -> FAIL${details ? ` (${details})` : ''}\n`);
    }
  }

  process.stdout.write('\n');

  // Improvements
  process.stdout.write(`IMPROVEMENTS (${improvements.length}):\n`);
  if (improvements.length === 0) {
    process.stdout.write('  (none)\n');
  } else {
    for (const r of improvements) {
      process.stdout.write(`  ${r.taskId} / ${r.modelId}: FAIL -> PASS\n`);
    }
  }

  process.stdout.write('\n');

  // Unchanged
  process.stdout.write(`UNCHANGED: ${unchanged.length}/${totalCompared}\n`);

  // Added / removed
  if (added.length > 0) {
    process.stdout.write(`\nADDED (not in baseline): ${added.length}\n`);
    for (const r of added) {
      process.stdout.write(`  ${r.taskId} / ${r.modelId}: ${r.current.pass ? 'PASS' : 'FAIL'}\n`);
    }
  }
  if (removed.length > 0) {
    process.stdout.write(`\nREMOVED (not in current): ${removed.length}\n`);
    for (const r of removed) {
      process.stdout.write(`  ${r.taskId} / ${r.modelId}: was ${r.baseline.pass ? 'PASS' : 'FAIL'}\n`);
    }
  }

  // Duration changes
  if (durationChanges.length > 0) {
    process.stdout.write('\nDURATION CHANGES (>10%):\n');
    for (const d of durationChanges) {
      const sign = parseFloat(d.pctChange) > 0 ? '+' : '';
      process.stdout.write(`  ${d.taskId} / ${d.modelId}: ${d.baselineDurationMs}ms -> ${d.currentDurationMs}ms (${sign}${d.pctChange}%)\n`);
    }
  }

  // Summary line
  const regLabel = regressions.length > 0 ? `${regressions.length} regression${regressions.length === 1 ? '' : 's'}` : '0 regressions';
  const impLabel = `${improvements.length} improvement${improvements.length === 1 ? '' : 's'}`;
  process.stdout.write(`\n=== Summary: ${regLabel}, ${impLabel} ===\n\n`);
}

/**
 * Format dimension-level changes for a regression entry.
 * @param {object} bDetails - Baseline dimension results
 * @param {object} cDetails - Current dimension results
 * @returns {string} Short description of which dimensions changed
 */
function formatDimChanges(bDetails, cDetails) {
  if (!bDetails || !cDetails) return '';
  const dims = ['format_compliance', 'completeness', 'correctness'];
  const changed = dims.filter(d => bDetails[d] !== cDetails[d]);
  return changed.map(d => `${d}: ${bDetails[d] ? 'pass' : 'fail'}->${cDetails[d] ? 'pass' : 'fail'}`).join(', ');
}

// ---------------------------------------------------------------------------
// Exports (for testing and programmatic use)
// ---------------------------------------------------------------------------

module.exports = { compareResults };

if (require.main === module) {
  main();
}
