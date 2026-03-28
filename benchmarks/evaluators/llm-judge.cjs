'use strict';

/**
 * LLM-as-judge evaluator for GSD benchmark outputs.
 *
 * On-demand quality assessment using Claude Sonnet as judge.
 * Always uses Sonnet (never the model being judged) to avoid self-serving bias.
 *
 * Usage (CLI):
 *   node benchmarks/benchmark-runner.cjs --judge --results .planning/benchmarks/results/2026-03-27-15-30-baseline.json
 *
 * Programmatic:
 *   const { judgeResult, judgeResults } = require('./evaluators/llm-judge.cjs');
 *   const scores = await judgeResult(taskDef, rawOutput);
 *   const judgedPath = judgeResults('/path/to/results.json');
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Judge model is always Claude Sonnet — never the model being evaluated.
// Using the same model being judged produces self-serving bias.
const JUDGE_MODEL = 'sonnet';
const JUDGE_EFFORT = 'medium';

/**
 * Build the judge prompt for a single task result.
 * @param {object} taskDef - Task definition (id, description, prompt, expected)
 * @param {string} rawOutput - Raw text output from the model under evaluation
 * @returns {string} Judge prompt string
 */
function buildJudgePrompt(taskDef, rawOutput) {
  const description = taskDef.description || taskDef.id || 'unknown task';
  const taskPrompt = taskDef.prompt || '(no prompt available)';

  return `You are evaluating the quality of an AI agent's response to a GSD workflow task.

Task: ${description}
Expected behavior: ${taskPrompt}

Model response:
---
${rawOutput}
---

Rate on a 1-5 scale:
1. coherence: Does the output make logical sense for the task?
2. gsd_compliance: Does it follow GSD conventions (wave structure, proper sections, etc.)?
3. verification_coverage: Would the output catch real regressions?
4. verbosity: Is the output appropriately concise (5=perfect length, 1=way too verbose or too terse)?

Return ONLY a JSON object: { "coherence": N, "gsd_compliance": N, "verification_coverage": N, "verbosity": N, "summary": "one sentence summary" }`;
}

/**
 * Invoke Claude Sonnet as judge for a single task result.
 *
 * @param {object} taskDef - Task definition (id, description, prompt, expected)
 * @param {string} rawOutput - Raw text output from the model under evaluation
 * @param {string} [judgeModel] - Override judge model (default: 'sonnet')
 * @returns {object} Judge scores: { coherence, gsd_compliance, verification_coverage, verbosity, summary, judge_model }
 *                   On error: { error, coherence: null, gsd_compliance: null, verification_coverage: null, verbosity: null, summary: null }
 */
function judgeResult(taskDef, rawOutput, judgeModel) {
  const model = judgeModel || JUDGE_MODEL;
  const judgePrompt = buildJudgePrompt(taskDef, rawOutput);

  let spawnResult;
  try {
    spawnResult = spawnSync('claude', [
      '-p', judgePrompt,
      '--model', model,
      '--effort', JUDGE_EFFORT,
      '--output-format', 'json',
      '--dangerously-skip-permissions',
      '--no-session-persistence',
    ], {
      encoding: 'utf-8',
      timeout: 60000, // Judge requests have a 60s timeout
      env: { ...process.env },
    });
  } catch (err) {
    return {
      error: `judge invocation failed: ${err.message}`,
      coherence: null,
      gsd_compliance: null,
      verification_coverage: null,
      verbosity: null,
      summary: null,
    };
  }

  if (spawnResult.status !== 0 || !spawnResult.stdout) {
    const errText = (spawnResult.stderr || spawnResult.stdout || 'unknown error').slice(0, 200);
    return {
      error: `judge invocation failed: exit ${spawnResult.status} — ${errText}`,
      coherence: null,
      gsd_compliance: null,
      verification_coverage: null,
      verbosity: null,
      summary: null,
    };
  }

  // Parse Claude's JSON response envelope
  let parsed;
  try {
    parsed = JSON.parse(spawnResult.stdout);
  } catch (e) {
    return {
      error: `judge response parse failed: ${e.message}`,
      coherence: null,
      gsd_compliance: null,
      verification_coverage: null,
      verbosity: null,
      summary: null,
    };
  }

  // Extract the text result (Claude returns { result: "...", ... })
  const resultText = parsed.result || parsed.output || spawnResult.stdout;

  // Extract JSON scores from result text
  let scores;
  try {
    scores = extractScoresJson(resultText);
  } catch (e) {
    return {
      error: `judge score extraction failed: ${e.message} — response: ${resultText.slice(0, 200)}`,
      coherence: null,
      gsd_compliance: null,
      verification_coverage: null,
      verbosity: null,
      summary: null,
    };
  }

  if (!scores) {
    return {
      error: `judge returned no parseable JSON scores — response: ${resultText.slice(0, 200)}`,
      coherence: null,
      gsd_compliance: null,
      verification_coverage: null,
      verbosity: null,
      summary: null,
    };
  }

  return {
    coherence: scores.coherence || null,
    gsd_compliance: scores.gsd_compliance || null,
    verification_coverage: scores.verification_coverage || null,
    verbosity: scores.verbosity || null,
    summary: scores.summary || null,
    judge_model: 'claude-sonnet-4.6',
  };
}

/**
 * Run LLM-as-judge on all passing results in a results JSON file.
 * Adds judge scores to each result with pass === true (structural check passed).
 * Writes output to {original_path_without_ext}-judged.json.
 *
 * @param {string} resultsPath - Absolute or relative path to results JSON file
 * @param {string} [judgeModel] - Override judge model (default: 'sonnet')
 * @returns {string} Path to judged results file
 */
function judgeResults(resultsPath, judgeModel) {
  const resolvedPath = path.resolve(resultsPath);
  const raw = fs.readFileSync(resolvedPath, 'utf-8');
  const results = JSON.parse(raw);

  // Load task definitions for descriptions
  const tasksDir = path.join(__dirname, '..', 'tasks');
  const taskMap = {};
  if (fs.existsSync(tasksDir)) {
    const taskFiles = fs.readdirSync(tasksDir).filter(f => f.endsWith('.json'));
    for (const file of taskFiles) {
      try {
        const task = JSON.parse(fs.readFileSync(path.join(tasksDir, file), 'utf-8'));
        taskMap[task.id] = task;
      } catch {}
    }
  }

  let judged = 0;
  let skipped = 0;

  // Iterate over all task+model combinations
  for (const [taskId, modelResults] of Object.entries(results.tasks || {})) {
    const taskDef = taskMap[taskId] || { id: taskId };

    for (const [modelId, result] of Object.entries(modelResults)) {
      // Only judge structurally passing results — no point judging failures
      if (!result || result.pass !== true) {
        skipped++;
        continue;
      }

      const rawOutput = result.raw_output || '';
      if (!rawOutput) {
        skipped++;
        continue;
      }

      process.stderr.write(`  Judging: ${taskId} / ${modelId} ...\n`);
      const judgeScores = judgeResult(taskDef, rawOutput, judgeModel);
      results.tasks[taskId][modelId].judge = judgeScores;
      judged++;
    }
  }

  process.stderr.write(`\nJudge complete: ${judged} judged, ${skipped} skipped (failed or no output)\n`);

  // Write to {original_without_ext}-judged.json
  const ext = path.extname(resolvedPath);
  const base = resolvedPath.slice(0, resolvedPath.length - ext.length);
  const outputPath = `${base}-judged${ext}`;

  fs.writeFileSync(outputPath, JSON.stringify(results, null, 2), 'utf-8');
  process.stdout.write(`Judged results written to: ${outputPath}\n`);
  return outputPath;
}

/**
 * Entry point for CLI invocation via benchmark-runner.cjs --judge flag.
 * Called as: require('./llm-judge.cjs').runJudge(resultsPath)
 * @param {string} resultsPath - Path to results JSON file
 */
function runJudge(resultsPath) {
  const outputPath = judgeResults(resultsPath);
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract and parse the JSON scores object from judge response text.
 * Tries multiple extraction strategies.
 * @param {string} text - Judge response text
 * @returns {object|null} Parsed scores or null
 */
function extractScoresJson(text) {
  if (!text) return null;

  // Strategy 1: Direct parse
  try { return JSON.parse(text); } catch {}

  // Strategy 2: Extract from ```json ... ``` block
  const codeMatch = text.match(/```json\s*\n([\s\S]*?)\n```/);
  if (codeMatch) {
    try { return JSON.parse(codeMatch[1]); } catch {}
  }

  // Strategy 3: Find first { ... } block
  const brace = text.indexOf('{');
  if (brace !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = brace; i < text.length; i++) {
      const c = text[i];
      if (escaped) { escaped = false; continue; }
      if (c === '\\' && inString) { escaped = true; continue; }
      if (c === '"') { inString = !inString; continue; }
      if (inString) continue;
      if (c === '{') depth++;
      else if (c === '}') {
        depth--;
        if (depth === 0) {
          try { return JSON.parse(text.substring(brace, i + 1)); } catch {}
          break;
        }
      }
    }
  }

  return null;
}

module.exports = { judgeResult, judgeResults, runJudge };
