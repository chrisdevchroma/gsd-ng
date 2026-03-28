#!/usr/bin/env node

/**
 * GSD Tools — CLI utility for GSD workflow operations
 *
 * Replaces repetitive inline bash patterns across ~50 GSD command/workflow/agent files.
 * Centralizes: config parsing, model resolution, phase lookup, git commits, summary verification.
 *
 * Usage: node gsd-tools.cjs <command> [args] [--raw]
 *
 * Atomic Commands:
 *   state load                         Load project config + state
 *   state json                         Output STATE.md frontmatter as JSON
 *   state update <field> <value>       Update a STATE.md field
 *   state get [section]                Get STATE.md content or section
 *   state patch --field val ...        Batch update STATE.md fields
 *   resolve-model <agent-type>         Get model for agent based on profile
 *   find-phase <phase>                 Find phase directory by number
 *   commit <message> [--files f1 f2]   Commit planning docs
 *   verify-summary <path>              Verify a SUMMARY.md file
 *   generate-slug <text>               Convert text to URL-safe slug
 *   current-timestamp [format]         Get timestamp (full|date|filename)
 *   list-todos [area]                  Count and enumerate pending todos
 *   recurring-due                      List recurring todos past their interval
 *   verify-path-exists <path>          Check file/directory existence
 *   config-ensure-section              Initialize .planning/config.json
 *   history-digest                     Aggregate all SUMMARY.md data
 *   summary-extract <path> [--fields]  Extract structured data from SUMMARY.md
 *   state-snapshot                     Structured parse of STATE.md
 *   phase-plan-index <phase>           Index plans with waves and status
 *   detect-platform [remote]            Detect git hosting platform from remote URL
 *                                      Returns: platform, source, cli, cli_installed
 *   detect-workspace                   Detect workspace topology (submodule/monorepo/standalone)
 *                                      Returns: type, signal
 *   discover-test-command              Discover test command(s) for this project
 *                                      Returns: [{dir, command}] array (empty if none found)
 *   version-bump                       Bump project version per configured scheme
 *     [--level major|minor|patch]       Override auto-derived bump level
 *     [--scheme semver|calver|date]     Override configured scheme
 *     [--snapshot]                      Append +{hash} to VERSION file only
 *   generate-changelog <version>       Generate CHANGELOG.md entries from SUMMARY.md files
 *     [--date YYYY-MM-DD]              Override date (default: today)
 *   generate-allowlist                 Generate .claude/settings.json permissions
 *                                      from static template + config-derived entries
 *   divergence                          Show upstream/branch drift and manage triage
 *     [--refresh]                       Fetch from upstream/remote first
 *     [--init]                          Create/update DIVERGENCE.md inventory
 *     [--triage <hash>]                 Update a commit's triage status
 *     [--branch <name>]                 Track branch instead of upstream
 *     [--base <ref>]                    Base ref for branch mode (default: git.target_branch or main)
 *     [--remote <name>]                 Remote name for upstream mode (default: upstream)
 *     [--remote-branch <branch>]        Remote branch for upstream mode (default: main)
 *   pingpong-check [--window N]         Detect agent oscillation in recent commits
 *   update [--dry-run]                Check for and install GSD updates
 *     [--local]                        Force local install path
 *     [--global]                       Force global install path
 *   cleanup [--dry-run]               Archive phase dirs from completed milestones
 *   breakout-check --plan {id}         Detect files modified outside plan scope
 *     --declared-files f1,f2,f3
 *   websearch <query>                  Search web via Brave API (if configured)
 *     [--limit N] [--freshness day|week|month]
 *
 * Phase Operations:
 *   phase next-decimal <phase>         Calculate next decimal phase number
 *   phase add <description>            Append new phase to roadmap + create dir
 *   phase insert <after> <description> Insert decimal phase after existing
 *   phase remove <phase> [--force]     Remove phase, renumber all subsequent
 *   phase complete <phase>             Mark phase done, update state + roadmap
 *
 * Roadmap Operations:
 *   roadmap get-phase <phase>          Extract phase section from ROADMAP.md
 *   roadmap analyze                    Full roadmap parse with disk status
 *   roadmap update-plan-progress <N>   Update progress table row from disk (PLAN vs SUMMARY counts)
 *
 * Requirements Operations:
 *   requirements mark-complete <ids>   Mark requirement IDs as complete in REQUIREMENTS.md
 *                                      Accepts: REQ-01,REQ-02 or REQ-01 REQ-02 or [REQ-01, REQ-02]
 *
 * Milestone Operations:
 *   milestone complete <version>       Archive milestone, create MILESTONES.md
 *     [--name <name>]
 *     [--archive-phases]               Move phase dirs to milestones/vX.Y-phases/
 *
 * Validation:
 *   validate consistency               Check phase numbering, disk/roadmap sync
 *   validate health [--repair]         Check .planning/ integrity, optionally repair
 *
 * Progress:
 *   progress [json|table|bar]          Render progress in various formats
 *
 * Todos:
 *   todo complete <filename>           Move todo from pending to completed
 *
 * Scaffolding:
 *   scaffold context --phase <N>       Create CONTEXT.md template
 *   scaffold uat --phase <N>           Create UAT.md template
 *   scaffold verification --phase <N>  Create VERIFICATION.md template
 *   scaffold phase-dir --phase <N>     Create phase directory
 *     --name <name>
 *
 * Frontmatter CRUD:
 *   frontmatter get <file> [--field k] Extract frontmatter as JSON
 *   frontmatter set <file> --field k   Update single frontmatter field
 *     --value jsonVal
 *   frontmatter merge <file>           Merge JSON into frontmatter
 *     --data '{json}'
 *   frontmatter validate <file>        Validate required fields
 *     --schema plan|summary|verification
 *
 * Verification Suite:
 *   verify plan-structure <file>       Check PLAN.md structure + tasks
 *   verify phase-completeness <phase>  Check all plans have summaries
 *   verify references <file>           Check @-refs + paths resolve
 *   verify commits <h1> [h2] ...      Batch verify commit hashes
 *   verify artifacts <plan-file>       Check must_haves.artifacts
 *   verify key-links <plan-file>       Check must_haves.key_links
 *
 * Template Fill:
 *   template fill summary --phase N    Create pre-filled SUMMARY.md
 *     [--plan M] [--name "..."]
 *     [--fields '{json}']
 *   template fill plan --phase N       Create pre-filled PLAN.md
 *     [--plan M] [--type execute|tdd]
 *     [--wave N] [--fields '{json}']
 *   template fill verification         Create pre-filled VERIFICATION.md
 *     --phase N [--fields '{json}']
 *
 * State Progression:
 *   state advance-plan                 Increment plan counter
 *   state record-metric --phase N      Record execution metrics
 *     --plan M --duration Xmin
 *     [--tasks N] [--files N]
 *   state update-progress              Recalculate progress bar
 *   state add-decision --summary "..."  Add decision to STATE.md
 *     [--phase N] [--rationale "..."]
 *     [--summary-file path] [--rationale-file path]
 *   state add-blocker --text "..."     Add blocker
 *     [--text-file path]
 *   state resolve-blocker --text "..." Remove blocker
 *   state record-session               Update session continuity
 *     --stopped-at "..."
 *     [--resume-file path]
 *   state begin-phase --phase N --name S --plans C  Update STATE.md for new phase start
 *
 * Compound Commands (workflow-specific initialization):
 *   init execute-phase <phase>         All context for execute-phase workflow
 *   init plan-phase <phase>            All context for plan-phase workflow
 *   init new-project                   All context for new-project workflow
 *   init new-milestone                 All context for new-milestone workflow
 *   init quick <description>           All context for quick workflow
 *   init resume                        All context for resume-project workflow
 *   init verify-work <phase>           All context for verify-work workflow
 *   init phase-op <phase>              Generic phase operation context
 *   init todos [area]                  All context for todo workflows
 *   init milestone-op                  All context for milestone operations
 *   init map-codebase                  All context for map-codebase workflow
 *   init progress                      All context for progress workflow
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const { error, output: coreOutput } = require('./lib/core.cjs');
const state = require('./lib/state.cjs');
const phase = require('./lib/phase.cjs');
const roadmap = require('./lib/roadmap.cjs');
const verify = require('./lib/verify.cjs');
const config = require('./lib/config.cjs');
const template = require('./lib/template.cjs');
const milestone = require('./lib/milestone.cjs');
const commands = require('./lib/commands.cjs');
const init = require('./lib/init.cjs');
const frontmatter = require('./lib/frontmatter.cjs');
const workspace = require('./lib/workspace.cjs');

// ─── Help ─────────────────────────────────────────────────────────────────────

function printHelp({ exitCode = 0 } = {}) {
  const src = fs.readFileSync(__filename, 'utf8');
  const match = src.match(/\/\*\*([\s\S]*?)\*\//);
  const out = exitCode !== 0 ? process.stderr : process.stdout;
  if (!match) { out.write('No help available.\n'); process.exit(exitCode); }
  const lines = match[1].split('\n').map(l => l.replace(/^\s*\*\s?/, '')).filter((_, i, arr) => i > 0 || arr[i].trim());
  out.write(lines.join('\n').trim() + '\n');
  process.exit(exitCode);
}

// Module-level state for --pick field extraction.
// Capture buffer is populated by fs.writeSync/process.stdout.write interception in main().
// Original references are stored so the post-run .then() handler can restore and write.
const _pickStdoutChunks = [];
let _origFsWriteSync = null;
let _origStdoutWrite = null;

// ─── CLI Router ───────────────────────────────────────────────────────────────

async function main() {
  const args = process.argv.slice(2);

  // Optional cwd override for sandboxed subagents running outside project root.
  let cwd = process.cwd();
  const cwdEqArg = args.find(arg => arg.startsWith('--cwd='));
  const cwdIdx = args.indexOf('--cwd');
  if (cwdEqArg) {
    const value = cwdEqArg.slice('--cwd='.length).trim();
    if (!value) error('Missing value for --cwd');
    args.splice(args.indexOf(cwdEqArg), 1);
    cwd = path.resolve(value);
  } else if (cwdIdx !== -1) {
    const value = args[cwdIdx + 1];
    if (!value || value.startsWith('--')) error('Missing value for --cwd');
    args.splice(cwdIdx, 2);
    cwd = path.resolve(value);
  } else {
    // No explicit --cwd: resolve git repo root to handle worktree contexts
    try {
      const repoRoot = execSync('git rev-parse --show-toplevel', {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'],
      }).trim();
      // Only use git root if it has a .planning directory
      // (avoids incorrectly resolving when invoked from a non-GSD repo)
      if (fs.existsSync(path.join(repoRoot, '.planning'))) {
        cwd = repoRoot;
      }
    } catch {
      // Not a git repo or git unavailable — keep process.cwd()
    }
  }

  if (!fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
    error(`Invalid --cwd: ${cwd}`);
  }

  const rawIndex = args.indexOf('--raw');
  const raw = rawIndex !== -1;
  if (rawIndex !== -1) args.splice(rawIndex, 1);

  // --pick <name>: extract a single field from JSON output (replaces jq dependency).
  // Supports dot-notation (e.g., --pick workflow.research) and bracket notation
  // for arrays (e.g., --pick directories[-1]).
  const pickIdx = args.indexOf('--pick');
  let pickField = null;
  if (pickIdx !== -1) {
    pickField = args[pickIdx + 1];
    if (!pickField || pickField.startsWith('--')) error('Missing value for --pick');
    args.splice(pickIdx, 2);
  }

  if (args.includes('--help') || args.includes('-h')) printHelp();

  const command = args[0];

  if (!command) printHelp({ exitCode: 1 });

  // When --pick is active, intercept stdout writes to extract a single field
  // from JSON output (replaces jq dependency). output() uses fs.writeSync(1, ...)
  // so we intercept at the fs layer; also intercept process.stdout.write for any
  // non-output() paths (printHelp, etc.).
  if (pickField) {
    _origFsWriteSync = fs.writeSync.bind(fs);
    _origStdoutWrite = process.stdout.write.bind(process.stdout);

    fs.writeSync = function (fd, data, ...rest) {
      if (fd === 1) {
        _pickStdoutChunks.push(String(data));
        return data.length;
      }
      return _origFsWriteSync(fd, data, ...rest);
    };

    process.stdout.write = function (data) {
      _pickStdoutChunks.push(String(data));
      return true;
    };

    // Intercept process.exit to flush captured output on error paths (e.g. error())
    const origExit = process.exit.bind(process);
    process.exit = function (code) {
      fs.writeSync = _origFsWriteSync;
      process.stdout.write = _origStdoutWrite;
      process.exit = origExit;
      if (code === 0 || code === undefined) {
        const captured = _pickStdoutChunks.join('');
        let jsonStr = captured;
        if (jsonStr.startsWith('@file:')) {
          try { jsonStr = fs.readFileSync(jsonStr.slice(6), 'utf-8'); } catch { jsonStr = captured; }
        }
        try {
          const obj = JSON.parse(jsonStr);
          const value = extractField(obj, pickField);
          const result = value === null || value === undefined ? '' : String(value);
          _origFsWriteSync(1, result);
        } catch { _origFsWriteSync(1, captured); }
      }
      origExit(code);
    };
  }

  switch (command) {
    case 'state': {
      const subcommand = args[1];
      if (subcommand === 'json') {
        state.cmdStateJson(cwd, raw);
      } else if (subcommand === 'update') {
        state.cmdStateUpdate(cwd, args[2], args[3]);
      } else if (subcommand === 'get') {
        state.cmdStateGet(cwd, args[2], raw);
      } else if (subcommand === 'patch') {
        const patches = {};
        for (let i = 2; i < args.length; i += 2) {
          const key = args[i].replace(/^--/, '');
          const value = args[i + 1];
          if (key && value !== undefined) {
            patches[key] = value;
          }
        }
        state.cmdStatePatch(cwd, patches, raw);
      } else if (subcommand === 'advance-plan') {
        state.cmdStateAdvancePlan(cwd, raw);
      } else if (subcommand === 'record-metric') {
        const phaseIdx = args.indexOf('--phase');
        const planIdx = args.indexOf('--plan');
        const durationIdx = args.indexOf('--duration');
        const tasksIdx = args.indexOf('--tasks');
        const filesIdx = args.indexOf('--files');
        state.cmdStateRecordMetric(cwd, {
          phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          plan: planIdx !== -1 ? args[planIdx + 1] : null,
          duration: durationIdx !== -1 ? args[durationIdx + 1] : null,
          tasks: tasksIdx !== -1 ? args[tasksIdx + 1] : null,
          files: filesIdx !== -1 ? args[filesIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'update-progress') {
        state.cmdStateUpdateProgress(cwd, raw);
      } else if (subcommand === 'add-decision') {
        const phaseIdx = args.indexOf('--phase');
        const summaryIdx = args.indexOf('--summary');
        const summaryFileIdx = args.indexOf('--summary-file');
        const rationaleIdx = args.indexOf('--rationale');
        const rationaleFileIdx = args.indexOf('--rationale-file');
        state.cmdStateAddDecision(cwd, {
          phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          summary: summaryIdx !== -1 ? args[summaryIdx + 1] : null,
          summary_file: summaryFileIdx !== -1 ? args[summaryFileIdx + 1] : null,
          rationale: rationaleIdx !== -1 ? args[rationaleIdx + 1] : '',
          rationale_file: rationaleFileIdx !== -1 ? args[rationaleFileIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'add-blocker') {
        const textIdx = args.indexOf('--text');
        const textFileIdx = args.indexOf('--text-file');
        state.cmdStateAddBlocker(cwd, {
          text: textIdx !== -1 ? args[textIdx + 1] : null,
          text_file: textFileIdx !== -1 ? args[textFileIdx + 1] : null,
        }, raw);
      } else if (subcommand === 'resolve-blocker') {
        const textIdx = args.indexOf('--text');
        state.cmdStateResolveBlocker(cwd, textIdx !== -1 ? args[textIdx + 1] : null, raw);
      } else if (subcommand === 'record-session') {
        const stoppedIdx = args.indexOf('--stopped-at');
        const resumeIdx = args.indexOf('--resume-file');
        state.cmdStateRecordSession(cwd, {
          stopped_at: stoppedIdx !== -1 ? args[stoppedIdx + 1] : null,
          resume_file: resumeIdx !== -1 ? args[resumeIdx + 1] : 'None',
        }, raw);
      } else if (subcommand === 'begin-phase') {
        const phaseIdx = args.indexOf('--phase');
        const nameIdx = args.indexOf('--name');
        const plansIdx = args.indexOf('--plans');
        state.cmdStateBeginPhase(
          cwd,
          phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          nameIdx !== -1 ? args[nameIdx + 1] : null,
          plansIdx !== -1 ? parseInt(args[plansIdx + 1], 10) : null,
          raw
        );
      } else {
        state.cmdStateLoad(cwd, raw);
      }
      break;
    }

    case 'resolve-model': {
      commands.cmdResolveModel(cwd, args[1], raw);
      break;
    }

    case 'find-phase': {
      phase.cmdFindPhase(cwd, args[1], raw);
      break;
    }

    case 'commit': {
      const amend = args.includes('--amend');
      const filesIndex = args.indexOf('--files');
      // Collect all positional args between command name and first flag,
      // then join them — handles both quoted ("multi word msg") and
      // unquoted (multi word msg) invocations from different shells
      const endIndex = filesIndex !== -1 ? filesIndex : args.length;
      const messageArgs = args.slice(1, endIndex).filter(a => !a.startsWith('--'));
      const message = messageArgs.join(' ') || undefined;
      const files = filesIndex !== -1 ? args.slice(filesIndex + 1).filter(a => !a.startsWith('--')) : [];
      commands.cmdCommit(cwd, message, files, raw, amend);
      break;
    }

    case 'verify-summary': {
      const summaryPath = args[1];
      const countIndex = args.indexOf('--check-count');
      const checkCount = countIndex !== -1 ? parseInt(args[countIndex + 1], 10) : 2;
      verify.cmdVerifySummary(cwd, summaryPath, checkCount, raw);
      break;
    }

    case 'template': {
      const subcommand = args[1];
      if (subcommand === 'select') {
        template.cmdTemplateSelect(cwd, args[2], raw);
      } else if (subcommand === 'fill') {
        const templateType = args[2];
        const phaseIdx = args.indexOf('--phase');
        const planIdx = args.indexOf('--plan');
        const nameIdx = args.indexOf('--name');
        const typeIdx = args.indexOf('--type');
        const waveIdx = args.indexOf('--wave');
        const fieldsIdx = args.indexOf('--fields');
        template.cmdTemplateFill(cwd, templateType, {
          phase: phaseIdx !== -1 ? args[phaseIdx + 1] : null,
          plan: planIdx !== -1 ? args[planIdx + 1] : null,
          name: nameIdx !== -1 ? args[nameIdx + 1] : null,
          type: typeIdx !== -1 ? args[typeIdx + 1] : 'execute',
          wave: waveIdx !== -1 ? args[waveIdx + 1] : '1',
          fields: fieldsIdx !== -1 ? JSON.parse(args[fieldsIdx + 1]) : {},
        }, raw);
      } else {
        error('Unknown template subcommand. Available: select, fill');
      }
      break;
    }

    case 'frontmatter': {
      const subcommand = args[1];
      const file = args[2];
      if (subcommand === 'get') {
        const fieldIdx = args.indexOf('--field');
        frontmatter.cmdFrontmatterGet(cwd, file, fieldIdx !== -1 ? args[fieldIdx + 1] : null, raw);
      } else if (subcommand === 'set') {
        const fieldIdx = args.indexOf('--field');
        const valueIdx = args.indexOf('--value');
        frontmatter.cmdFrontmatterSet(cwd, file, fieldIdx !== -1 ? args[fieldIdx + 1] : null, valueIdx !== -1 ? args[valueIdx + 1] : undefined, raw);
      } else if (subcommand === 'merge') {
        const dataIdx = args.indexOf('--data');
        frontmatter.cmdFrontmatterMerge(cwd, file, dataIdx !== -1 ? args[dataIdx + 1] : null, raw);
      } else if (subcommand === 'validate') {
        const schemaIdx = args.indexOf('--schema');
        frontmatter.cmdFrontmatterValidate(cwd, file, schemaIdx !== -1 ? args[schemaIdx + 1] : null, raw);
      } else {
        error('Unknown frontmatter subcommand. Available: get, set, merge, validate');
      }
      break;
    }

    case 'verify': {
      const subcommand = args[1];
      if (subcommand === 'plan-structure') {
        verify.cmdVerifyPlanStructure(cwd, args[2], raw);
      } else if (subcommand === 'phase-completeness') {
        verify.cmdVerifyPhaseCompleteness(cwd, args[2], raw);
      } else if (subcommand === 'references') {
        verify.cmdVerifyReferences(cwd, args[2], raw);
      } else if (subcommand === 'commits') {
        verify.cmdVerifyCommits(cwd, args.slice(2), raw);
      } else if (subcommand === 'artifacts') {
        verify.cmdVerifyArtifacts(cwd, args[2], raw);
      } else if (subcommand === 'key-links') {
        verify.cmdVerifyKeyLinks(cwd, args[2], raw);
      } else {
        error('Unknown verify subcommand. Available: plan-structure, phase-completeness, references, commits, artifacts, key-links');
      }
      break;
    }

    case 'generate-slug': {
      commands.cmdGenerateSlug(args[1], raw);
      break;
    }

    case 'current-timestamp': {
      commands.cmdCurrentTimestamp(args[1] || 'full', raw);
      break;
    }

    case 'list-todos': {
      commands.cmdListTodos(cwd, args[1], raw);
      break;
    }

    case 'recurring-due': {
      commands.cmdRecurringDue(cwd, raw);
      break;
    }

    case 'staleness-check': {
      commands.cmdStalenessCheck(cwd, raw);
      break;
    }

    case 'verify-path-exists': {
      commands.cmdVerifyPathExists(cwd, args[1], raw);
      break;
    }

    case 'config-ensure-section': {
      config.cmdConfigEnsureSection(cwd, raw);
      break;
    }

    case 'config-set': {
      config.cmdConfigSet(cwd, args[1], args[2], raw);
      break;
    }

    case "config-set-model-profile": {
      config.cmdConfigSetModelProfile(cwd, args[1], raw);
      break;
    }

    case 'config-get': {
      config.cmdConfigGet(cwd, args[1], raw);
      break;
    }

    case 'history-digest': {
      commands.cmdHistoryDigest(cwd, raw);
      break;
    }

    case 'phases': {
      const subcommand = args[1];
      if (subcommand === 'list') {
        const typeIndex = args.indexOf('--type');
        const phaseIndex = args.indexOf('--phase');
        const options = {
          type: typeIndex !== -1 ? args[typeIndex + 1] : null,
          phase: phaseIndex !== -1 ? args[phaseIndex + 1] : null,
          includeArchived: args.includes('--include-archived'),
        };
        phase.cmdPhasesList(cwd, options, raw);
      } else {
        error('Unknown phases subcommand. Available: list');
      }
      break;
    }

    case 'roadmap': {
      const subcommand = args[1];
      if (subcommand === 'get-phase') {
        roadmap.cmdRoadmapGetPhase(cwd, args[2], raw);
      } else if (subcommand === 'analyze') {
        roadmap.cmdRoadmapAnalyze(cwd, raw);
      } else if (subcommand === 'update-plan-progress') {
        roadmap.cmdRoadmapUpdatePlanProgress(cwd, args[2], raw);
      } else {
        error('Unknown roadmap subcommand. Available: get-phase, analyze, update-plan-progress');
      }
      break;
    }

    case 'requirements': {
      const subcommand = args[1];
      if (subcommand === 'mark-complete') {
        milestone.cmdRequirementsMarkComplete(cwd, args.slice(2), raw);
      } else {
        error('Unknown requirements subcommand. Available: mark-complete');
      }
      break;
    }

    case 'phase': {
      const subcommand = args[1];
      if (subcommand === 'next-decimal') {
        phase.cmdPhaseNextDecimal(cwd, args[2], raw);
      } else if (subcommand === 'add') {
        phase.cmdPhaseAdd(cwd, args.slice(2).join(' '), raw);
      } else if (subcommand === 'insert') {
        phase.cmdPhaseInsert(cwd, args[2], args.slice(3).join(' '), raw);
      } else if (subcommand === 'remove') {
        const forceFlag = args.includes('--force');
        phase.cmdPhaseRemove(cwd, args[2], { force: forceFlag }, raw);
      } else if (subcommand === 'complete') {
        phase.cmdPhaseComplete(cwd, args[2], raw);
      } else {
        error('Unknown phase subcommand. Available: next-decimal, add, insert, remove, complete');
      }
      break;
    }

    case 'milestone': {
      const subcommand = args[1];
      if (subcommand === 'complete') {
        const nameIndex = args.indexOf('--name');
        const archivePhases = args.includes('--archive-phases');
        // Collect --name value (everything after --name until next flag or end)
        let milestoneName = null;
        if (nameIndex !== -1) {
          const nameArgs = [];
          for (let i = nameIndex + 1; i < args.length; i++) {
            if (args[i].startsWith('--')) break;
            nameArgs.push(args[i]);
          }
          milestoneName = nameArgs.join(' ') || null;
        }
        milestone.cmdMilestoneComplete(cwd, args[2], { name: milestoneName, archivePhases }, raw);
      } else {
        error('Unknown milestone subcommand. Available: complete');
      }
      break;
    }

    case 'validate': {
      const subcommand = args[1];
      if (subcommand === 'consistency') {
        verify.cmdValidateConsistency(cwd, raw);
      } else if (subcommand === 'health') {
        const repairFlag = args.includes('--repair');
        verify.cmdValidateHealth(cwd, { repair: repairFlag }, raw);
      } else {
        error('Unknown validate subcommand. Available: consistency, health');
      }
      break;
    }

    case 'progress': {
      const subcommand = args[1] || 'json';
      commands.cmdProgressRender(cwd, subcommand, raw);
      break;
    }

    case 'stats': {
      const subcommand = args[1] || 'json';
      commands.cmdStats(cwd, subcommand, raw);
      break;
    }

    case 'todo': {
      const subcommand = args[1];
      if (subcommand === 'complete') {
        commands.cmdTodoComplete(cwd, args[2], raw);
      } else {
        error('Unknown todo subcommand. Available: complete');
      }
      break;
    }

    case 'update': {
      const dryRun = args.includes('--dry-run');
      const localInstall = args.includes('--local');
      const globalInstall = args.includes('--global');
      commands.cmdUpdate(cwd, { dryRun, local: localInstall, global: globalInstall }, raw);
      break;
    }

    case 'scaffold': {
      const scaffoldType = args[1];
      const phaseIndex = args.indexOf('--phase');
      const nameIndex = args.indexOf('--name');
      const scaffoldOptions = {
        phase: phaseIndex !== -1 ? args[phaseIndex + 1] : null,
        name: nameIndex !== -1 ? args.slice(nameIndex + 1).join(' ') : null,
      };
      commands.cmdScaffold(cwd, scaffoldType, scaffoldOptions, raw);
      break;
    }

    case 'init': {
      const workflow = args[1];
      switch (workflow) {
        case 'execute-phase':
          init.cmdInitExecutePhase(cwd, args[2], raw);
          break;
        case 'plan-phase':
          init.cmdInitPlanPhase(cwd, args[2], raw);
          break;
        case 'new-project':
          init.cmdInitNewProject(cwd, raw);
          break;
        case 'new-milestone':
          init.cmdInitNewMilestone(cwd, raw);
          break;
        case 'quick':
          init.cmdInitQuick(cwd, args.slice(2).join(' '), raw);
          break;
        case 'resume':
          init.cmdInitResume(cwd, raw);
          break;
        case 'verify-work':
          init.cmdInitVerifyWork(cwd, args[2], raw);
          break;
        case 'phase-op':
          init.cmdInitPhaseOp(cwd, args[2], raw);
          break;
        case 'todos':
          init.cmdInitTodos(cwd, args[2], raw);
          break;
        case 'milestone-op':
          init.cmdInitMilestoneOp(cwd, raw);
          break;
        case 'map-codebase':
          init.cmdInitMapCodebase(cwd, raw);
          break;
        case 'progress':
          init.cmdInitProgress(cwd, raw);
          break;
        default:
          error(`Unknown init workflow: ${workflow}\nAvailable: execute-phase, plan-phase, new-project, new-milestone, quick, resume, verify-work, phase-op, todos, milestone-op, map-codebase, progress`);
      }
      break;
    }

    case 'phase-plan-index': {
      phase.cmdPhasePlanIndex(cwd, args[1], raw);
      break;
    }

    case 'state-snapshot': {
      state.cmdStateSnapshot(cwd, raw);
      break;
    }

    case 'summary-extract': {
      const summaryPath = args[1];
      const fieldsIndex = args.indexOf('--fields');
      const fields = fieldsIndex !== -1 ? args[fieldsIndex + 1].split(',') : null;
      commands.cmdSummaryExtract(cwd, summaryPath, fields, raw);
      break;
    }

    case 'detect-platform': {
      // Support --field <name> --raw for scalar extraction (e.g. detect-platform --field platform --raw)
      const dpFieldIdx = args.indexOf('--field');
      const dpField = dpFieldIdx !== -1 ? args[dpFieldIdx + 1] : null;
      // Use the first non-flag positional argument as the remote name
      const dpRemoteArg = args[1] && !args[1].startsWith('--') ? args[1] : null;
      if (dpField && raw) {
        // silent=true: returns result without calling output()/process.exit()
        const dpResult = commands.cmdDetectPlatform(cwd, dpRemoteArg, false, true);
        if (dpResult && dpResult[dpField] !== undefined) {
          process.stdout.write(String(dpResult[dpField]));
        }
        process.exit(0);
      }
      commands.cmdDetectPlatform(cwd, dpRemoteArg, raw);
      break;
    }

    case 'detect-workspace': {
      workspace.cmdDetectWorkspace(cwd, raw);
      break;
    }

    case 'discover-test-command': {
      const result = commands.discoverTestCommand(cwd);
      coreOutput(result, raw);
      break;
    }

    case 'websearch': {
      const query = args[1];
      const limitIdx = args.indexOf('--limit');
      const freshnessIdx = args.indexOf('--freshness');
      await commands.cmdWebsearch(query, {
        limit: limitIdx !== -1 ? parseInt(args[limitIdx + 1], 10) : 10,
        freshness: freshnessIdx !== -1 ? args[freshnessIdx + 1] : null,
      }, raw);
      break;
    }

    case 'squash': {
      const listBackupTags = args.includes('--list-backup-tags');
      const phase = listBackupTags ? null : args[1];
      const dryRun = args.includes('--dry-run');
      const allowStable = args.includes('--allow-stable');
      const strategyIdx = args.indexOf('--strategy');
      const strategy = strategyIdx >= 0 ? args[strategyIdx + 1] : null;
      commands.cmdSquash(cwd, phase, {
        strategy,
        dryRun,
        allowStable,
        listBackupTags,
      }, raw);
      break;
    }

    case 'version-bump': {
      const levelIdx = args.indexOf('--level');
      const schemeIdx = args.indexOf('--scheme');
      const snapshot = args.includes('--snapshot');
      const vbFieldIdx = args.indexOf('--field');
      const vbField = vbFieldIdx !== -1 ? args[vbFieldIdx + 1] : null;
      if (vbField && raw) {
        // silent=true: returns result without calling output()/process.exit()
        const vbResult = commands.cmdVersionBump(cwd, {
          level: levelIdx >= 0 ? args[levelIdx + 1] : null,
          scheme: schemeIdx >= 0 ? args[schemeIdx + 1] : null,
          snapshot,
        }, false, true);
        if (vbResult && vbResult[vbField] !== undefined) {
          process.stdout.write(String(vbResult[vbField]));
        }
        process.exit(0);
      }
      commands.cmdVersionBump(cwd, {
        level: levelIdx >= 0 ? args[levelIdx + 1] : null,
        scheme: schemeIdx >= 0 ? args[schemeIdx + 1] : null,
        snapshot,
      }, raw);
      break;
    }

    case 'generate-changelog': {
      const version = args[1];
      const dateIdx = args.indexOf('--date');
      commands.cmdGenerateChangelog(cwd, version, {
        date: dateIdx >= 0 ? args[dateIdx + 1] : null,
      }, raw);
      break;
    }

    case 'generate-allowlist': {
      commands.cmdGenerateAllowlist(cwd, raw);
      break;
    }

    case 'resolve-type-alias': {
      // Resolve a short commit type to its branch prefix alias using git.type_aliases config.
      // Usage: gsd-tools resolve-type-alias feat --raw
      const typeArg = args[1] || 'feat';
      // git.type_aliases is nested in config.json under the git section.
      // loadConfig() returns a flat object so we read the raw config file directly.
      const rtaConfigPath = path.join(cwd, '.planning', 'config.json');
      let rtaAliases = { feat: 'feature', fix: 'bugfix', chore: 'chore', refactor: 'refactor' };
      try {
        const rawCfg = JSON.parse(fs.readFileSync(rtaConfigPath, 'utf-8'));
        if (rawCfg.git && rawCfg.git.type_aliases) {
          rtaAliases = rawCfg.git.type_aliases;
        }
      } catch {}
      const resolvedAlias = rtaAliases[typeArg] !== undefined ? rtaAliases[typeArg] : typeArg;
      if (raw) {
        process.stdout.write(resolvedAlias);
        process.exit(0);
      }
      coreOutput({ type: typeArg, alias: resolvedAlias }, false, resolvedAlias);
      break;
    }

    case 'issue-import': {
      const platform = args[1];
      const number = args[2];
      const repoIdx = args.indexOf('--repo');
      const repo = repoIdx >= 0 ? args[repoIdx + 1] : null;
      commands.cmdIssueImport(cwd, platform, number, repo, raw);
      break;
    }

    case 'issue-sync': {
      const phase = args[1] || null;
      const auto = args.includes('--auto');
      commands.cmdIssueSync(cwd, phase, { auto }, raw);
      break;
    }

    case 'issue-list-refs': {
      commands.cmdIssueListRefs(cwd, raw);
      break;
    }

    case 'divergence': {
      const refreshFlag = args.includes('--refresh');
      const initFlag = args.includes('--init');
      const triageIdx = args.indexOf('--triage');
      const statusIdx = args.indexOf('--status');
      const reasonIdx = args.indexOf('--reason');
      const branchIdx = args.indexOf('--branch');
      const baseIdx = args.indexOf('--base');
      const remoteIdx = args.indexOf('--remote');
      const remoteBranchIdx = args.indexOf('--remote-branch');
      const opts = {
        refresh: refreshFlag,
        init: initFlag,
        triage: triageIdx !== -1 ? args[triageIdx + 1] : null,
        status: statusIdx !== -1 ? args[statusIdx + 1] : null,
        reason: reasonIdx !== -1 ? args.slice(reasonIdx + 1).join(' ') : null,
        branch: branchIdx !== -1 ? args[branchIdx + 1] : null,
        base: baseIdx !== -1 ? args[baseIdx + 1] : null,
        remote: remoteIdx !== -1 ? args[remoteIdx + 1] : null,
        remoteBranch: remoteBranchIdx !== -1 ? args[remoteBranchIdx + 1] : null,
      };
      commands.cmdDivergence(cwd, opts, raw);
      break;
    }

    case 'pingpong-check': {
      const windowIdx = args.indexOf('--window');
      commands.cmdPingpongCheck(cwd, windowIdx !== -1 ? ['--window', args[windowIdx + 1]] : [], raw);
      break;
    }

    case 'breakout-check': {
      const planIdx = args.indexOf('--plan');
      const filesIdx = args.indexOf('--declared-files');
      const checkArgs = [];
      if (planIdx !== -1) { checkArgs.push('--plan', args[planIdx + 1]); }
      if (filesIdx !== -1) { checkArgs.push('--declared-files', args[filesIdx + 1]); }
      commands.cmdBreakoutCheck(cwd, checkArgs, raw);
      break;
    }

    case 'cleanup': {
      const dryRun = args.includes('--dry-run');
      commands.cmdCleanup(cwd, { dryRun }, raw);
      break;
    }

    case 'help':
      commands.cmdHelp(cwd, args.slice(1), raw);
      break;

    case '--help':
    case '-h':
      printHelp();
      break;

    default:
      error(`Unknown command: ${command}. Available commands include: issue-import, issue-sync, issue-list-refs, detect-platform, detect-workspace, discover-test-command, squash, version-bump, generate-changelog, and others.`);
  }
}

/**
 * Extract a field from an object using dot-notation and bracket syntax.
 * Supports: 'field', 'parent.child', 'arr[-1]', 'arr[0]'
 */
function extractField(obj, fieldPath) {
  const parts = fieldPath.split('.');
  let current = obj;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    const bracketMatch = part.match(/^(.+?)\[(-?\d+)]$/);
    if (bracketMatch) {
      const key = bracketMatch[1];
      const index = parseInt(bracketMatch[2], 10);
      current = current[key];
      if (!Array.isArray(current)) return undefined;
      current = index < 0 ? current[current.length + index] : current[index];
    } else {
      current = current[part];
    }
  }
  return current;
}

// Capture pickField before main() runs so the .then() closure can access it.
// main() sets pickField as a local — we need it for the post-run extraction.
// Re-parse --pick from argv here (main() hasn't spliced it yet at module scope).
const _pickFieldForPostRun = (() => {
  const i = process.argv.indexOf('--pick');
  return i !== -1 ? process.argv[i + 1] : null;
})();

main().then(() => {
  if (_pickFieldForPostRun && _pickStdoutChunks.length > 0) {
    // Normal success path: output() wrote via fs.writeSync interception; process.exit not called.
    // Restore originals first, then extract and write the requested field to real stdout.
    if (_origFsWriteSync) fs.writeSync = _origFsWriteSync;
    if (_origStdoutWrite) process.stdout.write = _origStdoutWrite;

    let captured = _pickStdoutChunks.join('');
    if (captured.startsWith('@file:')) {
      try { captured = fs.readFileSync(captured.slice(6), 'utf-8'); } catch { /* keep as-is */ }
    }
    try {
      const obj = JSON.parse(captured);
      const value = extractField(obj, _pickFieldForPostRun);
      const result = value === null || value === undefined ? '' : String(value);
      process.stdout.write(result);
    } catch {
      process.stdout.write(captured);
    }
  }
}).catch((err) => {
  process.stderr.write((err && err.message) || String(err));
  process.exit(1);
});
