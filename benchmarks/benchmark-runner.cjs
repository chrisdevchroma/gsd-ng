#!/usr/bin/env node
'use strict';

/**
 * GSD Cross-Model Benchmark Runner
 *
 * Invokes claude and copilot CLI subprocesses against a synthetic fixture project,
 * evaluates outputs structurally, and writes JSON results.
 *
 * Usage:
 *   node benchmarks/benchmark-runner.cjs --claude
 *   node benchmarks/benchmark-runner.cjs --copilot
 *   node benchmarks/benchmark-runner.cjs --claude --copilot
 *   node benchmarks/benchmark-runner.cjs --validate-tasks
 *   node benchmarks/benchmark-runner.cjs --dry-run --claude
 *   node benchmarks/benchmark-runner.cjs --task micro-frontmatter-parse --claude
 *   node benchmarks/benchmark-runner.cjs --model claude-sonnet-4.6
 *
 * CRITICAL: No default model group. User MUST pass --claude and/or --copilot explicitly.
 * Bare invocation exits with help text and code 1. This keeps expensive Copilot
 * premium requests opt-in and lets Claude runs happen independently.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Resolve paths relative to the benchmarks/ directory (where this script lives)
const BENCHMARKS_DIR = __dirname;
const CONFIG_PATH = path.join(BENCHMARKS_DIR, 'benchmark-config.json');
const TASKS_DIR = path.join(BENCHMARKS_DIR, 'tasks');
const FIXTURE_BASE = path.join(BENCHMARKS_DIR, 'fixtures', 'gsd-test-project');
const EVALUATORS_DIR = path.join(BENCHMARKS_DIR, 'evaluators');

// ---------------------------------------------------------------------------
// Help text
// ---------------------------------------------------------------------------

const HELP_TEXT = `
GSD Cross-Model Benchmark Runner

USAGE:
  node benchmarks/benchmark-runner.cjs [flags]

FLAGS:
  --claude              Run Claude models (group === "claude")
  --copilot             Run Copilot models (group === "copilot")
                        (Use both --claude --copilot to run all models)
  --validate-tasks      Validate all task JSON files and exit (no model invocation)
  --task <id>           Run a single task by ID (default: all tasks)
  --model <id>          Run a single model by ID (overrides --claude/--copilot filter)
  --judge               Run LLM-as-judge evaluation on existing results
  --results <path>      Path to existing results JSON (used with --judge)
  --dry-run             Print what would run without invoking models
  --help                Print this help text

EXAMPLES:
  node benchmarks/benchmark-runner.cjs --claude
  node benchmarks/benchmark-runner.cjs --copilot
  node benchmarks/benchmark-runner.cjs --claude --copilot
  node benchmarks/benchmark-runner.cjs --validate-tasks
  node benchmarks/benchmark-runner.cjs --dry-run --claude
  node benchmarks/benchmark-runner.cjs --task micro-frontmatter-parse --claude
  node benchmarks/benchmark-runner.cjs --model claude-sonnet-4.6

NOTE: --claude and/or --copilot is REQUIRED unless using --validate-tasks, --help,
      or --model. Bare invocation exits with this help text and code 1.
      This is intentional: expensive Copilot premium requests must always be opt-in.
`.trim();

// ---------------------------------------------------------------------------
// Config and task loading
// ---------------------------------------------------------------------------

/**
 * Read and parse benchmark-config.json from the benchmarks/ directory.
 * @returns {object} Parsed config object
 */
function loadConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Read all *.json files from tasks/ directory.
 * @param {string|null} filterTaskId - If set, return only that task
 * @returns {object[]} Array of task definition objects
 */
function loadTasks(filterTaskId) {
  const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.json'));
  const tasks = files.map(f => {
    const raw = fs.readFileSync(path.join(TASKS_DIR, f), 'utf-8');
    return JSON.parse(raw);
  });
  if (filterTaskId) {
    return tasks.filter(t => t.id === filterTaskId);
  }
  return tasks;
}

/**
 * Validate all task JSON files. Checks required fields and expected schema.
 * @param {object[]} tasks - Array of task definitions
 * @param {object} config - Benchmark config (unused currently, available for future checks)
 * @returns {boolean} true if all tasks pass validation
 */
function validateTasks(tasks, config) {
  const REQUIRED_FIELDS = ['id', 'type', 'prompt', 'timeout_ms', 'at_refs', 'runtime_filter', 'expected'];
  let allPassed = true;

  for (const task of tasks) {
    let taskPassed = true;
    const errors = [];

    // Check required fields
    for (const field of REQUIRED_FIELDS) {
      if (task[field] === undefined || task[field] === null) {
        errors.push(`missing required field: ${field}`);
        taskPassed = false;
      }
    }

    // Check expected has at least format
    if (task.expected && !task.expected.format) {
      errors.push('expected.format is required');
      taskPassed = false;
    }

    // Check type is valid
    if (task.type && !['micro', 'core'].includes(task.type)) {
      errors.push(`invalid type: ${task.type} (must be micro or core)`);
      taskPassed = false;
    }

    // Check runtime_filter is valid
    if (task.runtime_filter && !['all', 'claude-only', 'copilot-only'].includes(task.runtime_filter)) {
      errors.push(`invalid runtime_filter: ${task.runtime_filter}`);
      taskPassed = false;
    }

    const status = taskPassed ? 'PASS' : 'FAIL';
    process.stdout.write(`  ${status}: ${task.id || '(unnamed task)'}\n`);
    if (errors.length > 0) {
      for (const err of errors) {
        process.stdout.write(`       - ${err}\n`);
      }
    }

    if (!taskPassed) allPassed = false;
  }

  return allPassed;
}

// ---------------------------------------------------------------------------
// Temp directory / fixture management
// ---------------------------------------------------------------------------

/**
 * Resolve a writable temp directory — TMPDIR may not be accessible in some environments.
 *
 * NOTE: This function is intentionally duplicated from tests/helpers.cjs. The benchmark
 * runner is a standalone CLI tool and cannot import from the tests/ directory. If the
 * logic in helpers.cjs::resolveTmpDir() changes (e.g., new candidate paths, fallback order),
 * this copy must be updated to match.
 *
 * @returns {string} Path to writable temp dir
 */
function resolveTmpDir() {
  const candidates = [process.env.TMPDIR, os.tmpdir(), `/tmp/claude-${process.getuid()}`, '/tmp'].filter(Boolean);
  for (const dir of candidates) {
    try {
      if (fs.existsSync(dir)) return dir;
    } catch {}
  }
  return os.tmpdir();
}

/**
 * Copy gsd-test-project fixture to a unique temp dir and initialize a git repo.
 * Returns the temp dir path. Each task gets its own isolated copy.
 * @param {string} fixtureBase - Path to the fixture project directory
 * @returns {string} Path to the temp copy
 */
function copyFixture(fixtureBase) {
  const tmpBase = resolveTmpDir();
  const uniqueName = `gsd-bench-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const dest = path.join(tmpBase, uniqueName);

  fs.cpSync(fixtureBase, dest, { recursive: true });

  // Initialize git repo in the copy for a realistic project environment
  spawnSync('git', ['init'], { cwd: dest, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.email', 'bench@gsd-test.local'], { cwd: dest, encoding: 'utf-8' });
  spawnSync('git', ['config', 'user.name', 'GSD Benchmark'], { cwd: dest, encoding: 'utf-8' });
  spawnSync('git', ['add', '-A'], { cwd: dest, encoding: 'utf-8' });
  spawnSync('git', ['commit', '-m', 'Initial fixture state'], { cwd: dest, encoding: 'utf-8' });

  return dest;
}

/**
 * Remove a temp fixture directory.
 * @param {string} dir - Path to remove
 */
function cleanupFixture(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Prompt substitution
// ---------------------------------------------------------------------------

/**
 * Replace {{REF_PREFIX}} in prompt string with the model's ref_prefix.
 * @param {string} prompt - Prompt template
 * @param {object} model - Model definition with ref_prefix field
 * @returns {string} Substituted prompt
 */
function substituteRefs(prompt, model) {
  return prompt.replace(/\{\{REF_PREFIX\}\}/g, model.ref_prefix || '');
}

// ---------------------------------------------------------------------------
// Error classification
// ---------------------------------------------------------------------------

/**
 * Classify a spawnSync error result into a category.
 * @param {object} spawnResult - Result from spawnSync
 * @returns {string} Error type: timeout | rate_limit | model_unavailable | crash
 */
function classifyError(spawnResult) {
  // status === null means the process was killed (timeout via SIGTERM)
  if (spawnResult.status === null) return 'timeout';

  const output = ((spawnResult.stdout || '') + (spawnResult.stderr || '')).toLowerCase();

  if (output.includes('overloaded') || output.includes('rate') || output.includes('quota')) {
    return 'rate_limit';
  }
  if (output.includes('not available') || output.includes('not found')) {
    return 'model_unavailable';
  }
  return 'crash';
}

// ---------------------------------------------------------------------------
// Model subprocess invocation
// ---------------------------------------------------------------------------

/**
 * Invoke Claude via `claude -p` with JSON output.
 * Uses --output-format json, --dangerously-skip-permissions, --no-session-persistence.
 * @param {string} prompt - The task prompt
 * @param {object} model - Model definition from config
 * @param {number} timeoutMs - Max execution time in ms
 * @param {string} workdir - Working directory (fixture copy)
 * @returns {object} Result with raw_output, usage, cost_usd, exit_code, duration_ms, error_type
 */
function runClaude(prompt, model, timeoutMs, workdir) {
  const startMs = Date.now();

  const args = [
    '-p', prompt,
    '--model', model.model_flag,
    ...(model.effort_flag ? ['--effort', model.effort_flag] : []),
    '--output-format', 'json',
    '--dangerously-skip-permissions',
    '--no-session-persistence',
  ];
  const result = spawnSync('claude', args, {
    cwd: workdir,
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: { ...process.env },
  });

  const duration_ms = Date.now() - startMs;

  if (result.status !== 0 || !result.stdout) {
    return {
      raw_output: result.stdout || result.stderr || '',
      exit_code: result.status,
      duration_ms,
      error_type: classifyError(result),
      usage: null,
      cost_usd: null,
    };
  }

  let parsed;
  try {
    parsed = JSON.parse(result.stdout);
  } catch (e) {
    return {
      raw_output: result.stdout,
      exit_code: result.status,
      duration_ms,
      error_type: 'crash',
      usage: null,
      cost_usd: null,
    };
  }

  return {
    raw_output: parsed.result || parsed.output || result.stdout,
    usage: parsed.modelUsage || null,
    cost_usd: parsed.total_cost_usd || null,
    exit_code: result.status,
    duration_ms,
    error_type: null,
  };
}

/**
 * Invoke Copilot via `copilot -p` with plain text output.
 * NOTE: Does NOT use --output-format json — Copilot emits NDJSON event stream,
 * not a single JSON object. We capture plain text and strip trailing usage stats.
 * @param {string} prompt - The task prompt
 * @param {object} model - Model definition from config
 * @param {number} timeoutMs - Max execution time in ms
 * @param {string} workdir - Working directory (fixture copy)
 * @returns {object} Result with raw_output, usage, cost_usd, exit_code, duration_ms, error_type
 */
function runCopilot(prompt, model, timeoutMs, workdir) {
  const startMs = Date.now();

  const args = [
    '-p', prompt,
    '--model', model.model_flag,
    ...(model.effort_flag ? ['--effort', model.effort_flag] : []),
    '--allow-all-tools',
    '--allow-all-paths',
  ];
  const result = spawnSync('copilot', args, {
    cwd: workdir,
    encoding: 'utf-8',
    timeout: timeoutMs,
    env: { ...process.env },
  });

  const duration_ms = Date.now() - startMs;

  if (result.status !== 0 && !result.stdout) {
    return {
      raw_output: result.stdout || result.stderr || '',
      exit_code: result.status,
      duration_ms,
      error_type: classifyError(result),
      usage: null,
      cost_usd: null,
    };
  }

  // Strip trailing usage stats block (Copilot appends "Total usage est: ..." at end)
  let responseText = result.stdout || '';
  const usageSplit = responseText.split('\nTotal usage est:');
  responseText = usageSplit[0].trim();

  return {
    raw_output: responseText,
    usage: null,
    cost_usd: null,
    exit_code: result.status,
    duration_ms,
    error_type: null,
  };
}

/**
 * Dispatch to the correct runtime (claude or copilot).
 * @param {object} model - Model definition
 * @param {string} prompt - Task prompt
 * @param {number} timeoutMs - Timeout in ms
 * @param {string} workdir - Fixture working directory
 * @returns {object} Invocation result
 */
function runModel(model, prompt, timeoutMs, workdir) {
  if (model.runtime === 'claude') {
    return runClaude(prompt, model, timeoutMs, workdir);
  }
  if (model.runtime === 'copilot') {
    return runCopilot(prompt, model, timeoutMs, workdir);
  }
  throw new Error(`Unknown runtime: ${model.runtime}`);
}

// ---------------------------------------------------------------------------
// Model and task filtering
// ---------------------------------------------------------------------------

/**
 * Filter models based on enabled flag and group/id filters.
 * CRITICAL: If neither runClaude nor runCopilot is true and filterModelId is null,
 * caller is responsible for exiting with help. This function only applies the filters.
 * @param {object} config - Benchmark config with models array
 * @param {object} opts - { runClaude, runCopilot, filterModelId }
 * @returns {object[]} Filtered array of model definitions
 */
function filterModels(config, { runClaude: wantClaude, runCopilot: wantCopilot, filterModelId }) {
  let models = config.models.filter(m => m.enabled === true);

  if (filterModelId) {
    // --model overrides group flags
    models = models.filter(m => m.id === filterModelId);
    if (models.length === 0) {
      // Try disabled models too (user explicitly requested this model)
      models = config.models.filter(m => m.id === filterModelId);
    }
    return models;
  }

  // Apply group filter
  models = models.filter(m => {
    if (wantClaude && m.group === 'claude') return true;
    if (wantCopilot && m.group === 'copilot') return true;
    return false;
  });

  return models;
}

/**
 * Filter tasks based on which model groups are present.
 * @param {object[]} tasks - All task definitions
 * @param {object[]} models - Models that will run
 * @returns {object[]} Tasks applicable to the model set
 */
function filterTasks(tasks, models) {
  const hasClaudeModels = models.some(m => m.group === 'claude');
  const hasCopilotModels = models.some(m => m.group === 'copilot');

  return tasks.filter(task => {
    if (task.runtime_filter === 'claude-only' && !hasClaudeModels) return false;
    if (task.runtime_filter === 'copilot-only' && !hasCopilotModels) return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// @ reference matrix
// ---------------------------------------------------------------------------

/**
 * Aggregate @ ref results across all tasks and models.
 * Groups by ref type and runtime.
 * @param {object} resultsMap - { task_id: { model_id: { at_ref_verified, ... } } }
 * @returns {object} Matrix of { ref_type: { runtime: true/false } }
 */
function buildAtRefMatrix(resultsMap) {
  const matrix = {};

  for (const [, modelResults] of Object.entries(resultsMap)) {
    for (const [modelId, evalResult] of Object.entries(modelResults)) {
      if (!evalResult || !evalResult.at_ref_verified) continue;

      // Look up runtime from model id
      const runtime = modelId.startsWith('copilot-') ? 'copilot' : 'claude';

      for (const [refType, verified] of Object.entries(evalResult.at_ref_verified)) {
        if (!matrix[refType]) {
          matrix[refType] = {};
        }
        // If any task+model combo verified this ref type, count it as supported
        // If already true, keep true; otherwise update with current result
        if (matrix[refType][runtime] === undefined) {
          matrix[refType][runtime] = verified;
        } else if (verified === true) {
          matrix[refType][runtime] = true;
        }
      }
    }
  }

  return matrix;
}

// ---------------------------------------------------------------------------
// Results writing
// ---------------------------------------------------------------------------

/**
 * Write results JSON to config.result_dir with timestamp filename.
 * Format: YYYY-MM-DD-HH-MM-baseline.json
 * @param {object} resultsMap - Task/model evaluation results
 * @param {object} atRefMatrix - @ ref compatibility matrix
 * @param {object} config - Benchmark config
 * @param {object[]} models - Models that ran
 */
function writeResults(resultsMap, atRefMatrix, config, models) {
  const resultDir = path.resolve(BENCHMARKS_DIR, '..', '..', config.defaults.result_dir || '.planning/benchmarks/results');
  fs.mkdirSync(resultDir, { recursive: true });

  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}`;
  const filename = `${timestamp}-baseline.json`;
  const filepath = path.join(resultDir, filename);

  // Build pass_rate_by_model summary
  const passRateByModel = {};
  for (const model of models) {
    let passed = 0;
    let total = 0;
    for (const taskResults of Object.values(resultsMap)) {
      const mr = taskResults[model.id];
      if (mr !== undefined) {
        total++;
        if (mr.pass === true) passed++;
      }
    }
    passRateByModel[model.id] = total > 0 ? `${passed}/${total}` : '0/0';
  }

  const totalTasks = Object.keys(resultsMap).length;

  const output = {
    captured: now.toISOString(),
    models: models.map(m => m.id),
    tasks: resultsMap,
    at_ref_matrix: atRefMatrix,
    summary: {
      total_tasks: totalTasks,
      models_tested: models.length,
      pass_rate_by_model: passRateByModel,
    },
  };

  fs.writeFileSync(filepath, JSON.stringify(output, null, 2), 'utf-8');
  process.stdout.write(`\nResults written to: ${filepath}\n`);
  return filepath;
}

// ---------------------------------------------------------------------------
// Main benchmark execution loop
// ---------------------------------------------------------------------------

/**
 * Main execution loop. Runs all tasks sequentially against all applicable models.
 * Uses spawnSync (synchronous) — parallelism via multiple process invocations.
 * @param {object} config - Benchmark config
 * @param {object[]} tasks - Task definitions
 * @param {object[]} models - Model definitions
 * @param {boolean} dryRun - If true, print plan without invoking
 * @returns {object} Results map { task_id: { model_id: eval_result } }
 */
function runBenchmarks(config, tasks, models, dryRun) {
  // Lazy-load structural evaluator
  const { evaluateOutput } = require(path.join(EVALUATORS_DIR, 'structural.cjs'));

  const resultsMap = {};

  for (const task of tasks) {
    resultsMap[task.id] = {};

    // Determine which models can run this task
    const applicableModels = models.filter(m => {
      if (task.runtime_filter === 'claude-only' && m.group !== 'claude') return false;
      if (task.runtime_filter === 'copilot-only' && m.group !== 'copilot') return false;
      return true;
    });

    for (const model of applicableModels) {
      if (dryRun) {
        process.stdout.write(`  [dry-run] ${task.id} x ${model.id}\n`);
        continue;
      }

      process.stderr.write(`Running: ${task.id} / ${model.id} ...\n`);

      let fixtureDir = null;
      let evalResult = null;

      try {
        fixtureDir = copyFixture(FIXTURE_BASE);
        const prompt = substituteRefs(task.prompt, model);
        const timeoutMs = task.timeout_ms || config.defaults.timeout_ms || 120000;

        const modelResult = runModel(model, prompt, timeoutMs, fixtureDir);

        if (modelResult.error_type) {
          process.stderr.write(`  ERROR (${modelResult.error_type}): ${task.id} / ${model.id}\n`);
          evalResult = {
            error_type: modelResult.error_type,
            exit_code: modelResult.exit_code,
            duration_ms: modelResult.duration_ms,
            format_compliance: false,
            completeness: false,
            correctness: false,
            at_ref_verified: {},
            token_efficiency: { output_chars: 0, expected_range: {}, within_range: false },
            pass: false,
          };
        } else {
          const structural = evaluateOutput(task, modelResult.raw_output);
          evalResult = {
            ...structural,
            exit_code: modelResult.exit_code,
            duration_ms: modelResult.duration_ms,
            cost_usd: modelResult.cost_usd,
            usage: modelResult.usage,
          };
        }
      } catch (err) {
        process.stderr.write(`  EXCEPTION: ${task.id} / ${model.id}: ${err.message}\n`);
        evalResult = {
          error_type: 'crash',
          error_message: err.message,
          pass: false,
        };
      } finally {
        if (fixtureDir) {
          try { cleanupFixture(fixtureDir); } catch {}
        }
      }

      resultsMap[task.id][model.id] = evalResult;
    }
  }

  return resultsMap;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

/**
 * Main CLI entry point. Parses args, loads config and tasks, executes benchmarks.
 */
function main() {
  const args = process.argv.slice(2);

  const flags = {
    helpFlag: args.includes('--help'),
    validateTasks: args.includes('--validate-tasks'),
    dryRun: args.includes('--dry-run'),
    runClaudeFlag: args.includes('--claude'),
    runCopilotFlag: args.includes('--copilot'),
    judgeFlag: args.includes('--judge'),
  };

  const taskIdx = args.indexOf('--task');
  const filterTaskId = taskIdx !== -1 ? args[taskIdx + 1] : null;

  const modelIdx = args.indexOf('--model');
  const filterModelId = modelIdx !== -1 ? args[modelIdx + 1] : null;

  const resultsIdx = args.indexOf('--results');
  const resultsPath = resultsIdx !== -1 ? args[resultsIdx + 1] : null;

  // --help always exits 0
  if (flags.helpFlag) {
    process.stdout.write(HELP_TEXT + '\n');
    process.exit(0);
  }

  // --validate-tasks: validate all task JSON files without invoking models
  if (flags.validateTasks) {
    process.stdout.write('Validating task definitions...\n');
    const config = loadConfig();
    const tasks = loadTasks(null);
    process.stdout.write(`Found ${tasks.length} task files.\n`);
    const allPassed = validateTasks(tasks, config);
    if (allPassed) {
      process.stdout.write(`\nAll ${tasks.length} tasks passed validation.\n`);
      process.exit(0);
    } else {
      process.stdout.write('\nValidation FAILED. See errors above.\n');
      process.exit(1);
    }
  }

  // CRITICAL: Require explicit runtime selection. No default model group.
  // This prevents accidental expensive Copilot premium API calls.
  if (!flags.runClaudeFlag && !flags.runCopilotFlag && !filterModelId) {
    process.stderr.write('ERROR: No runtime specified. You must pass --claude and/or --copilot.\n\n');
    process.stderr.write(HELP_TEXT + '\n');
    process.exit(1);
  }

  // --judge: delegate to llm-judge evaluator
  if (flags.judgeFlag) {
    if (!resultsPath) {
      process.stderr.write('ERROR: --judge requires --results <path> to specify existing results JSON.\n');
      process.exit(1);
    }
    try {
      const judgeModule = require(path.join(EVALUATORS_DIR, 'llm-judge.cjs'));
      judgeModule.runJudge(resultsPath);
    } catch (e) {
      process.stderr.write(`ERROR: Could not load llm-judge.cjs: ${e.message}\n`);
      process.exit(1);
    }
    return;
  }

  // Load config and tasks
  const config = loadConfig();
  const tasks = loadTasks(filterTaskId);

  if (tasks.length === 0) {
    process.stderr.write(`ERROR: No tasks found${filterTaskId ? ` matching id: ${filterTaskId}` : ''}.\n`);
    process.exit(1);
  }

  // Filter models
  const models = filterModels(config, {
    runClaude: flags.runClaudeFlag,
    runCopilot: flags.runCopilotFlag,
    filterModelId,
  });

  if (models.length === 0) {
    process.stderr.write('ERROR: No enabled models match the specified filters.\n');
    process.exit(1);
  }

  // Filter tasks to applicable subset
  const applicableTasks = filterTasks(tasks, models);

  if (flags.dryRun) {
    process.stdout.write(`Dry run — would execute ${applicableTasks.length} task(s) x ${models.length} model(s):\n\n`);
    for (const task of applicableTasks) {
      for (const model of models) {
        const skip = (task.runtime_filter === 'claude-only' && model.group !== 'claude') ||
                     (task.runtime_filter === 'copilot-only' && model.group !== 'copilot');
        if (!skip) {
          process.stdout.write(`  ${task.id} x ${model.id}\n`);
        }
      }
    }
    process.exit(0);
  }

  // Print run summary
  process.stdout.write(`\nGSD Benchmark Run\n`);
  process.stdout.write(`Models: ${models.map(m => m.id).join(', ')}\n`);
  process.stdout.write(`Tasks: ${applicableTasks.length} task(s)\n\n`);

  // Execute benchmarks
  const resultsMap = runBenchmarks(config, applicableTasks, models, false);

  // Build @ ref matrix
  const atRefMatrix = buildAtRefMatrix(resultsMap);

  // Write results JSON
  writeResults(resultsMap, atRefMatrix, config, models);

  // Print pass/fail summary
  process.stdout.write('\nSummary:\n');
  for (const model of models) {
    let passed = 0;
    let total = 0;
    for (const taskResults of Object.values(resultsMap)) {
      const mr = taskResults[model.id];
      if (mr !== undefined) {
        total++;
        if (mr.pass === true) passed++;
      }
    }
    process.stdout.write(`  ${model.id}: ${passed}/${total} passed\n`);
  }

  process.exit(0);
}

// Export internal functions for unit testing
module.exports = {
  loadConfig,
  loadTasks,
  validateTasks,
  copyFixture,
  cleanupFixture,
  substituteRefs,
  classifyError,
  filterModels,
  filterTasks,
  buildAtRefMatrix,
  writeResults,
  runModel,       // needed by variant-compare.cjs for real model invocation in Phase 39.1
};

if (require.main === module) {
  main();
}
