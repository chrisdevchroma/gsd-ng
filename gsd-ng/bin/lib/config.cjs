/**
 * Config — Planning config CRUD operations
 */

const fs = require('fs');
const path = require('path');
const { output, error, planningPaths } = require('./core.cjs');
const {
  VALID_PROFILES,
  getAgentToModelMapForProfile,
  formatAgentToModelMapAsTable,
} = require('./model-profiles.cjs');

const VALID_CONFIG_KEYS = new Set([
  'mode', 'granularity', 'parallelization', 'commit_docs', 'model_profile',
  'search_gitignored',
  'workflow.research', 'workflow.plan_check', 'workflow.verifier',
  'workflow.nyquist_validation', 'workflow.ui_phase', 'workflow.ui_safety_gate',
  'workflow._auto_chain_active', 'workflow.guardrail_enabled',
  'git.branching_strategy', 'git.phase_branch_template', 'git.milestone_branch_template',
  'git.target_branch', 'git.auto_push', 'git.remote',
  'git.review_branch_template', 'git.type_aliases',
  'git.pr_template', 'git.pr_draft', 'git.platform',
  'git.commit_format', 'git.commit_template', 'git.versioning_scheme',
  'planning.commit_docs', 'planning.search_gitignored',
  'issue_tracker.auto_sync',
  'issue_tracker.default_action',
  'issue_tracker.comment_style',
  'issue_tracker.close_state',
  'issue_tracker.verify_label',
  'verification.test_command',
  'statusline.components.git_branch',
  'statusline.components.token_breakdown',
  'statusline.components.cross_model_warning',
  'statusline.components.api_limits',
  'git.ssh_check',
]);

const SUBMODULE_KEY_PATTERN = /^git\.submodules\.[^.]+\.(target_branch|branching_strategy|phase_branch_template|milestone_branch_template|review_branch_template|remote|auto_push|platform|pr_template|pr_draft|commit_format|commit_template|versioning_scheme|type_aliases|ssh_check)$/;

const CONFIG_KEY_SUGGESTIONS = {
  'workflow.nyquist_validation_enabled': 'workflow.nyquist_validation',
  'agents.nyquist_validation_enabled': 'workflow.nyquist_validation',
  'nyquist.validation_enabled': 'workflow.nyquist_validation',
};

function validateKnownConfigKeyPath(keyPath) {
  const suggested = CONFIG_KEY_SUGGESTIONS[keyPath];
  if (suggested) {
    error(`Unknown config key: ${keyPath}. Did you mean ${suggested}?`);
  }
}

/**
 * Ensures the config file exists (creates it if needed).
 *
 * Does not call `output()`, so can be used as one step in a command without triggering `exit(0)` in
 * the happy path. But note that `error()` will still `exit(1)` out of the process.
 */
function ensureConfigFile(cwd) {
  const { config: configPath, root: planningDir } = planningPaths(cwd);

  // Ensure .planning directory exists
  try {
    if (!fs.existsSync(planningDir)) {
      fs.mkdirSync(planningDir, { recursive: true });
    }
  } catch (err) {
    error('Failed to create .planning directory: ' + err.message);
  }

  // Check if config already exists
  if (fs.existsSync(configPath)) {
    return { created: false, reason: 'already_exists' };
  }

  // Load user-level defaults from ~/.gsd/defaults.json if available
  const homedir = require('os').homedir();
  const globalDefaultsPath = path.join(homedir, '.gsd', 'defaults.json');
  let userDefaults = {};
  try {
    if (fs.existsSync(globalDefaultsPath)) {
      userDefaults = JSON.parse(fs.readFileSync(globalDefaultsPath, 'utf-8'));
      // Migrate deprecated "depth" key to "granularity"
      if ('depth' in userDefaults && !('granularity' in userDefaults)) {
        const depthToGranularity = { quick: 'coarse', standard: 'standard', comprehensive: 'fine' };
        userDefaults.granularity = depthToGranularity[userDefaults.depth] || userDefaults.depth;
        delete userDefaults.depth;
        try {
          fs.writeFileSync(globalDefaultsPath, JSON.stringify(userDefaults, null, 2), 'utf-8');
        } catch {}
      }
    }
  } catch (err) {
    // Ignore malformed global defaults, fall back to hardcoded
  }

  // Create default config (user-level defaults override hardcoded defaults)
  const hardcoded = {
    model_profile: 'balanced',
    commit_docs: true,
    search_gitignored: false,
    branching_strategy: 'none',
    phase_branch_template: 'gsd/phase-{phase}-{slug}',
    milestone_branch_template: 'gsd/{milestone}-{slug}',
    workflow: {
      research: true,
      plan_check: true,
      verifier: true,
      nyquist_validation: true,
    },
    parallelization: true,
  };
  const defaults = {
    ...hardcoded,
    ...userDefaults,
    workflow: { ...hardcoded.workflow, ...(userDefaults.workflow || {}) },
  };

  try {
    fs.writeFileSync(configPath, JSON.stringify(defaults, null, 2), 'utf-8');
    return { created: true, path: '.planning/config.json' };
  } catch (err) {
    error('Failed to create config.json: ' + err.message);
  }
}

/**
 * Command to ensure the config file exists (creates it if needed).
 *
 * Note that this exits the process (via `output()`) even in the happy path; use
 * `ensureConfigFile()` directly if you need to avoid this.
 */
function cmdConfigEnsureSection(cwd) {
  const ensureConfigFileResult = ensureConfigFile(cwd);
  if (ensureConfigFileResult.created) {
    output(ensureConfigFileResult, 'created');
  } else {
    output(ensureConfigFileResult, 'exists');
  }
}

/**
 * Sets a value in the config file, allowing nested values via dot notation (e.g.,
 * "workflow.research").
 *
 * Does not call `output()`, so can be used as one step in a command without triggering `exit(0)` in
 * the happy path. But note that `error()` will still `exit(1)` out of the process.
 */
function setConfigValue(cwd, keyPath, parsedValue) {
  const { config: configPath } = planningPaths(cwd);

  // Load existing config or start with empty object
  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    }
  } catch (err) {
    error('Failed to read config.json: ' + err.message);
  }

  // Set nested value using dot notation (e.g., "workflow.research")
  const keys = keyPath.split('.');
  let current = config;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (current[key] === undefined || typeof current[key] !== 'object') {
      current[key] = {};
    }
    current = current[key];
  }
  const previousValue = current[keys[keys.length - 1]]; // Capture previous value before overwriting
  current[keys[keys.length - 1]] = parsedValue;

  // Write back
  try {
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf-8');
    return { updated: true, key: keyPath, value: parsedValue, previousValue };
  } catch (err) {
    error('Failed to write config.json: ' + err.message);
  }
}

/**
 * Command to set a value in the config file, allowing nested values via dot notation (e.g.,
 * "workflow.research").
 *
 * Note that this exits the process (via `output()`) even in the happy path; use `setConfigValue()`
 * directly if you need to avoid this.
 */
function cmdConfigSet(cwd, keyPath, value) {
  if (!keyPath) {
    error('Usage: config-set <key.path> <value>');
  }

  validateKnownConfigKeyPath(keyPath);

  if (keyPath === 'git.submodule.workspace_branch') {
    error('git.submodule.workspace_branch is deprecated — the workspace stays on git.target_branch when branching_strategy is none.');
  }

  if (!VALID_CONFIG_KEYS.has(keyPath) && !SUBMODULE_KEY_PATTERN.test(keyPath)) {
    error(`Unknown config key: "${keyPath}". Valid keys: ${[...VALID_CONFIG_KEYS].sort().join(', ')}`);
  }

  // Parse value (handle booleans and numbers)
  let parsedValue = value;
  if (value === 'true') parsedValue = true;
  else if (value === 'false') parsedValue = false;
  else if (!isNaN(value) && value !== '') parsedValue = Number(value);

  const setConfigValueResult = setConfigValue(cwd, keyPath, parsedValue);
  output(setConfigValueResult, `${keyPath}=${parsedValue}`);
}

function cmdConfigGet(cwd, keyPath, defaultValue) {
  const { config: configPath } = planningPaths(cwd);

  if (!keyPath) {
    error('Usage: config-get <key.path>');
  }

  if (keyPath === 'git.submodule.workspace_branch') {
    process.stderr.write('Warning: git.submodule.workspace_branch is deprecated — the workspace stays on git.target_branch when branching_strategy is none.\n');
  }

  let config = {};
  try {
    if (fs.existsSync(configPath)) {
      config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    } else {
      if (defaultValue !== undefined) {
        output(defaultValue, String(defaultValue));
        return;
      }
      error('No config.json found at ' + configPath);
    }
  } catch (err) {
    if (err.message.startsWith('No config.json')) throw err;
    error('Failed to read config.json: ' + err.message);
  }

  // Traverse dot-notation path (e.g., "workflow.auto_advance")
  const keys = keyPath.split('.');
  let current = config;
  for (const key of keys) {
    if (current === undefined || current === null || typeof current !== 'object') {
      if (defaultValue !== undefined) {
        output(defaultValue, String(defaultValue));
        return;
      }
      error(`Key not found: ${keyPath}`);
    }
    current = current[key];
  }

  if (current === undefined) {
    if (defaultValue !== undefined) {
      output(defaultValue, String(defaultValue));
      return;
    }
    error(`Key not found: ${keyPath}`);
  }

  output(current, String(current));
}

/**
 * Command to set the model profile in the config file.
 *
 * Note that this exits the process (via `output()`) even in the happy path.
 */
function cmdConfigSetModelProfile(cwd, profile) {
  if (!profile) {
    error(`Usage: config-set-model-profile <${VALID_PROFILES.join('|')}>`);
  }

  const normalizedProfile = profile.toLowerCase().trim();
  if (!VALID_PROFILES.includes(normalizedProfile)) {
    error(`Invalid profile '${profile}'. Valid profiles: ${VALID_PROFILES.join(', ')}`);
  }

  // Ensure config exists (create if needed)
  ensureConfigFile(cwd);

  // Set the model profile in the config
  const { previousValue } = setConfigValue(cwd, 'model_profile', normalizedProfile);
  const previousProfile = previousValue || 'balanced';

  // Build result value / message and return
  const agentToModelMap = getAgentToModelMapForProfile(normalizedProfile);
  const result = {
    updated: true,
    profile: normalizedProfile,
    previousProfile,
    agentToModelMap,
  };
  const rawValue = getCmdConfigSetModelProfileResultMessage(
    normalizedProfile,
    previousProfile,
    agentToModelMap
  );
  output(result, rawValue);
}

/**
 * Returns the message to display for the result of the `config-set-model-profile` command when
 * displaying raw output.
 */
function getCmdConfigSetModelProfileResultMessage(
  normalizedProfile,
  previousProfile,
  agentToModelMap
) {
  const agentToModelTable = formatAgentToModelMapAsTable(agentToModelMap);
  const didChange = previousProfile !== normalizedProfile;
  const paragraphs = didChange
    ? [
        `✓ Model profile set to: ${normalizedProfile} (was: ${previousProfile})`,
        'Agents will now use:',
        agentToModelTable,
        'Next spawned agents will use the new profile.',
      ]
    : [
        `✓ Model profile is already set to: ${normalizedProfile}`,
        'Agents are using:',
        agentToModelTable,
      ];
  return paragraphs.join('\n\n');
}

module.exports = {
  cmdConfigEnsureSection,
  cmdConfigSet,
  cmdConfigGet,
  cmdConfigSetModelProfile,
  setConfigValue,
};
