'use strict';

/**
 * Unit tests for the GSD benchmark harness.
 *
 * Tests verify: config parsing, task validation, structural evaluator,
 * fixture isolation, results writing, model filtering, and ref substitution.
 *
 * CRITICAL: No test invokes real `claude` or `copilot` subprocesses.
 * All subprocess-dependent logic is tested via controlled inputs or by
 * exercising the exported functions directly.
 */

const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Resolve paths relative to the gsd-ng/ directory (cwd when running tests)
const BENCHMARKS_DIR = path.join(__dirname, '..', 'benchmarks');
const TASKS_DIR = path.join(BENCHMARKS_DIR, 'tasks');
const FIXTURE_BASE = path.join(BENCHMARKS_DIR, 'fixtures', 'gsd-test-project');

// Import modules under test
const {
  loadConfig,
  loadTasks,
  validateTasks,
  copyFixture,
  cleanupFixture,
  substituteRefs,
  classifyError,
  filterModels,
} = require('../benchmarks/benchmark-runner.cjs');

const { evaluateOutput } = require('../benchmarks/evaluators/structural.cjs');

// Resolve writable temp dir (sandbox-safe, same pattern as helpers.cjs)
function resolveTmpDir() {
  const candidates = [process.env.TMPDIR, os.tmpdir(), `/tmp/claude-${process.getuid()}`, '/tmp'].filter(Boolean);
  for (const dir of candidates) {
    try { if (fs.existsSync(dir)) return dir; } catch {}
  }
  return os.tmpdir();
}

// ---------------------------------------------------------------------------
// 1. Config parsing — BENCH-01
// ---------------------------------------------------------------------------

describe('config parsing', () => {
  it('loads and parses benchmark-config.json', () => {
    const config = loadConfig();
    assert.ok(Array.isArray(config.models), 'config.models must be an array');
    assert.ok(typeof config.defaults === 'object', 'config.defaults must be an object');
    assert.ok(typeof config.defaults.result_dir === 'string', 'config.defaults.result_dir must be a string');
  });

  it('config has claude and copilot model groups', () => {
    const config = loadConfig();
    const claudeModels = config.models.filter(m => m.group === 'claude');
    const copilotModels = config.models.filter(m => m.group === 'copilot');
    assert.strictEqual(claudeModels.length, 3, 'should have exactly 3 claude models');
    assert.ok(copilotModels.length >= 2, 'should have at least 2 copilot models');
  });

  it('every model has required fields', () => {
    const config = loadConfig();
    const requiredFields = ['id', 'runtime', 'model_flag', 'group', 'enabled', 'ref_prefix'];
    const optionalNullableFields = ['effort_flag']; // null for non-thinking models
    for (const model of config.models) {
      for (const field of requiredFields) {
        assert.ok(
          model[field] !== undefined && model[field] !== null,
          `model ${model.id || '(unnamed)'} is missing required field: ${field}`
        );
      }
      for (const field of optionalNullableFields) {
        assert.ok(
          field in model,
          `model ${model.id || '(unnamed)'} is missing field: ${field} (may be null)`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Task validation — BENCH-08
// ---------------------------------------------------------------------------

describe('task validation', () => {
  it('all task files are valid JSON', () => {
    const files = fs.readdirSync(TASKS_DIR).filter(f => f.endsWith('.json'));
    assert.ok(files.length > 0, 'tasks directory must contain JSON files');
    for (const file of files) {
      const raw = fs.readFileSync(path.join(TASKS_DIR, file), 'utf-8');
      assert.doesNotThrow(
        () => JSON.parse(raw),
        `${file} is not valid JSON`
      );
    }
  });

  it('all tasks have required schema fields', () => {
    const tasks = loadTasks();
    const requiredFields = ['id', 'type', 'prompt', 'timeout_ms', 'at_refs', 'runtime_filter', 'expected'];
    for (const task of tasks) {
      for (const field of requiredFields) {
        assert.ok(
          task[field] !== undefined && task[field] !== null,
          `task ${task.id || '(unnamed)'} is missing required field: ${field}`
        );
      }
    }
  });

  it('micro tasks have 30s timeout', () => {
    const tasks = loadTasks();
    const microTasks = tasks.filter(t => t.type === 'micro');
    assert.ok(microTasks.length > 0, 'must have at least one micro task');
    for (const task of microTasks) {
      assert.strictEqual(
        task.timeout_ms,
        30000,
        `micro task ${task.id} must have timeout_ms === 30000, got ${task.timeout_ms}`
      );
    }
  });

  it('core tasks have 120s timeout', () => {
    const tasks = loadTasks();
    const coreTasks = tasks.filter(t => t.type === 'core');
    assert.ok(coreTasks.length > 0, 'must have at least one core task');
    for (const task of coreTasks) {
      assert.strictEqual(
        task.timeout_ms,
        120000,
        `core task ${task.id} must have timeout_ms === 120000, got ${task.timeout_ms}`
      );
    }
  });

  it('at least 15 tasks defined', () => {
    const tasks = loadTasks();
    assert.ok(tasks.length >= 15, `expected at least 15 tasks, found ${tasks.length}`);
  });

  it('@ ref tasks include relative, tilde, and project-relative patterns', () => {
    const tasks = loadTasks();
    // Collect union of all at_refs values across all tasks
    const allRefs = new Set();
    for (const task of tasks) {
      if (Array.isArray(task.at_refs)) {
        for (const ref of task.at_refs) {
          allRefs.add(ref);
        }
      }
    }
    assert.ok(allRefs.has('relative'), 'tasks must include at least one "relative" at_ref');
    assert.ok(allRefs.has('tilde'), 'tasks must include at least one "tilde" at_ref');
    assert.ok(allRefs.has('project-relative'), 'tasks must include at least one "project-relative" at_ref');
  });

  it('claude-only tasks exist for tilde refs', () => {
    const tasks = loadTasks();
    const tildeTasks = tasks.filter(t => Array.isArray(t.at_refs) && t.at_refs.includes('tilde'));
    assert.ok(tildeTasks.length > 0, 'must have at least one task with tilde at_ref');
    for (const task of tildeTasks) {
      assert.strictEqual(
        task.runtime_filter,
        'claude-only',
        `task ${task.id} with tilde ref must have runtime_filter === "claude-only"`
      );
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Structural evaluator — BENCH-04
// ---------------------------------------------------------------------------

describe('structural evaluator', () => {
  it('passes valid JSON output with correct fields', () => {
    const taskDef = {
      id: 'test-json',
      at_refs: ['none'],
      expected: {
        format: 'json_block',
        required_fields: ['title', 'area'],
      },
    };
    const rawOutput = JSON.stringify({ title: 'Fix bug', area: 'cli' });
    const result = evaluateOutput(taskDef, rawOutput);
    assert.strictEqual(result.format_compliance, true, 'format_compliance should be true');
    assert.strictEqual(result.completeness, true, 'completeness should be true');
    assert.strictEqual(result.pass, true, 'pass should be true');
  });

  it('fails when required fields are missing', () => {
    const taskDef = {
      id: 'test-missing-fields',
      at_refs: ['none'],
      expected: {
        format: 'json_block',
        required_fields: ['title', 'area', 'priority'],
      },
    };
    // Output is missing 'priority'
    const rawOutput = JSON.stringify({ title: 'Fix bug', area: 'cli' });
    const result = evaluateOutput(taskDef, rawOutput);
    assert.strictEqual(result.completeness, false, 'completeness should be false when field is missing');
    assert.strictEqual(result.pass, false, 'pass should be false when completeness fails');
  });

  it('fails when forbidden content is present', () => {
    const taskDef = {
      id: 'test-forbidden',
      at_refs: ['none'],
      expected: {
        format: 'any',
        not_contains: ['apology', 'sorry'],
      },
    };
    const rawOutput = 'I am sorry I cannot complete this task.';
    const result = evaluateOutput(taskDef, rawOutput);
    assert.strictEqual(result.correctness, false, 'correctness should be false when forbidden content present');
    assert.strictEqual(result.pass, false, 'pass should be false');
  });

  it('passes markdown format check', () => {
    const taskDef = {
      id: 'test-markdown',
      at_refs: ['none'],
      expected: {
        format: 'markdown',
      },
    };
    const rawOutput = '# Phase Plan\n\n## Objective\n\nTest plan content.';
    const result = evaluateOutput(taskDef, rawOutput);
    assert.strictEqual(result.format_compliance, true, 'markdown with headings should pass format check');
  });

  it('extracts JSON from code blocks', () => {
    const taskDef = {
      id: 'test-code-block',
      at_refs: ['none'],
      expected: {
        format: 'json_block',
        required_fields: ['name'],
      },
    };
    const rawOutput = 'Here is the result:\n\n```json\n{"name": "gsd-test"}\n```';
    const result = evaluateOutput(taskDef, rawOutput);
    assert.strictEqual(result.format_compliance, true, 'should extract JSON from code block');
    assert.strictEqual(result.completeness, true, 'completeness should pass with required field present');
  });

  it('handles empty output gracefully', () => {
    const taskDef = {
      id: 'test-empty',
      at_refs: ['none'],
      expected: { format: 'json_block' },
    };
    let result;
    assert.doesNotThrow(() => {
      result = evaluateOutput(taskDef, '');
    }, 'evaluateOutput must not throw on empty input');
    assert.strictEqual(result.pass, false, 'empty output should not pass');
  });

  it('reports token efficiency', () => {
    const taskDef = {
      id: 'test-token-efficiency',
      at_refs: ['none'],
      expected: { format: 'any' },
    };
    const rawOutput = 'Hello, this is a test output.';
    const result = evaluateOutput(taskDef, rawOutput);
    assert.strictEqual(
      result.token_efficiency.output_chars,
      rawOutput.length,
      'output_chars must match rawOutput.length'
    );
  });
});

// ---------------------------------------------------------------------------
// 4. Fixture isolation — BENCH-07
// ---------------------------------------------------------------------------

describe('fixture isolation', () => {
  it('copies fixture to unique temp directory', () => {
    const dest = copyFixture(FIXTURE_BASE);
    try {
      assert.ok(fs.existsSync(dest), 'temp directory must exist after copyFixture');
      assert.ok(
        fs.existsSync(path.join(dest, '.planning', 'STATE.md')),
        'copied fixture must contain .planning/STATE.md'
      );
    } finally {
      cleanupFixture(dest);
    }
  });

  it('copied fixture has independent state', () => {
    const dest1 = copyFixture(FIXTURE_BASE);
    const dest2 = copyFixture(FIXTURE_BASE);
    try {
      // Write a file to dest1
      const testFile = path.join(dest1, '.planning', 'test-isolation-marker.txt');
      fs.writeFileSync(testFile, 'isolation test');

      // dest2 must NOT have that file
      const dest2TestFile = path.join(dest2, '.planning', 'test-isolation-marker.txt');
      assert.ok(!fs.existsSync(dest2TestFile), 'file written to dest1 must not appear in dest2');
    } finally {
      cleanupFixture(dest1);
      cleanupFixture(dest2);
    }
  });

  it('cleanup removes temp directory', () => {
    const dest = copyFixture(FIXTURE_BASE);
    assert.ok(fs.existsSync(dest), 'temp directory must exist before cleanup');
    cleanupFixture(dest);
    assert.ok(!fs.existsSync(dest), 'temp directory must not exist after cleanup');
  });
});

// ---------------------------------------------------------------------------
// 5. Results write — BENCH-06
// ---------------------------------------------------------------------------

describe('results write', () => {
  it('writes results JSON to timestamped file', () => {
    const tmpBase = resolveTmpDir();
    const tmpResultDir = fs.mkdtempSync(path.join(tmpBase, 'gsd-bench-results-'));

    try {
      // Replicate the writeResults logic from benchmark-runner.cjs
      const now = new Date();
      const pad = n => String(n).padStart(2, '0');
      const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}-${pad(now.getHours())}-${pad(now.getMinutes())}`;
      const filename = `${timestamp}-baseline.json`;
      const filepath = path.join(tmpResultDir, filename);

      const mockResults = {
        captured: now.toISOString(),
        phase: 'pre-phase-39',
        models: ['claude-sonnet-4.6'],
        tasks: {
          'micro-frontmatter-parse': {
            'claude-sonnet-4.6': { pass: true, format_compliance: true, completeness: true, correctness: true },
          },
        },
        at_ref_matrix: { relative: { claude: true } },
        summary: {
          total_tasks: 1,
          models_tested: 1,
          pass_rate_by_model: { 'claude-sonnet-4.6': '1/1' },
        },
      };

      fs.writeFileSync(filepath, JSON.stringify(mockResults, null, 2), 'utf-8');
      assert.ok(fs.existsSync(filepath), 'results file must exist after write');

      // Verify it parses as valid JSON
      assert.doesNotThrow(() => JSON.parse(fs.readFileSync(filepath, 'utf-8')));
    } finally {
      fs.rmSync(tmpResultDir, { recursive: true, force: true });
    }
  });

  it('results JSON has required top-level fields', () => {
    const tmpBase = resolveTmpDir();
    const tmpResultDir = fs.mkdtempSync(path.join(tmpBase, 'gsd-bench-results2-'));

    try {
      const mockResults = {
        captured: new Date().toISOString(),
        models: ['claude-sonnet-4.6'],
        tasks: {},
        at_ref_matrix: {},
        summary: { total_tasks: 0, models_tested: 1, pass_rate_by_model: {} },
      };

      const filepath = path.join(tmpResultDir, 'test-results.json');
      fs.writeFileSync(filepath, JSON.stringify(mockResults, null, 2), 'utf-8');

      const parsed = JSON.parse(fs.readFileSync(filepath, 'utf-8'));
      const requiredFields = ['captured', 'models', 'tasks', 'at_ref_matrix', 'summary'];
      for (const field of requiredFields) {
        assert.ok(
          field in parsed,
          `results JSON must have top-level field: ${field}`
        );
      }
    } finally {
      fs.rmSync(tmpResultDir, { recursive: true, force: true });
    }
  });
});

// ---------------------------------------------------------------------------
// 6. Model filtering
// ---------------------------------------------------------------------------

describe('model filtering', () => {
  it('--claude filters to claude group only', () => {
    const config = loadConfig();
    const models = filterModels(config, { runClaude: true, runCopilot: false, filterModelId: null });
    assert.ok(models.length > 0, 'should return at least one claude model');
    for (const m of models) {
      assert.strictEqual(m.group, 'claude', `model ${m.id} must be in claude group`);
    }
  });

  it('--copilot filters to copilot group only', () => {
    const config = loadConfig();
    const models = filterModels(config, { runClaude: false, runCopilot: true, filterModelId: null });
    assert.ok(models.length > 0, 'should return at least one copilot model');
    for (const m of models) {
      assert.strictEqual(m.group, 'copilot', `model ${m.id} must be in copilot group`);
    }
  });

  it('--claude --copilot includes both groups', () => {
    const config = loadConfig();
    const models = filterModels(config, { runClaude: true, runCopilot: true, filterModelId: null });
    const groups = new Set(models.map(m => m.group));
    assert.ok(groups.has('claude'), 'result must include claude group');
    assert.ok(groups.has('copilot'), 'result must include copilot group');
  });

  it('--model filters to single model', () => {
    const config = loadConfig();
    const models = filterModels(config, { runClaude: false, runCopilot: false, filterModelId: 'claude-opus-4.6' });
    assert.strictEqual(models.length, 1, 'filterModelId should return exactly 1 model');
    assert.strictEqual(models[0].id, 'claude-opus-4.6');
  });
});

// ---------------------------------------------------------------------------
// 7. Ref substitution
// ---------------------------------------------------------------------------

describe('ref substitution', () => {
  it('replaces {{REF_PREFIX}} with model ref_prefix', () => {
    const model = { ref_prefix: '~/.claude/gsd-ng' };
    const result = substituteRefs('Read @{{REF_PREFIX}}/file.md', model);
    assert.strictEqual(result, 'Read @~/.claude/gsd-ng/file.md');
  });

  it('leaves prompt unchanged when no {{REF_PREFIX}}', () => {
    const model = { ref_prefix: '~/.claude/gsd-ng' };
    const prompt = 'Read @.planning/STATE.md and summarize.';
    const result = substituteRefs(prompt, model);
    assert.strictEqual(result, prompt, 'prompt without {{REF_PREFIX}} must be returned unchanged');
  });
});
