'use strict';

/**
 * Centralized default values for all config consumers.
 *
 * Single source of truth — eliminates duplication across core.cjs, config.cjs,
 * init.cjs, workspace.cjs, and verify.cjs. This module intentionally has zero
 * internal imports (only Node.js built-ins) to avoid circular dependencies.
 */

const DEFAULTS = Object.freeze({
  model_profile: 'balanced',
  commit_docs: true,
  search_gitignored: false,
  branching_strategy: 'none',
  phase_branch_template: 'gsd/phase-{phase}-{slug}',
  milestone_branch_template: 'gsd/{milestone}-{slug}',
  target_branch: 'main',
  auto_push: false,
  remote: 'origin',
  review_branch_template: '{type}/{phase}-{slug}',
  pr_draft: true,
  platform: null,
  commit_format: 'gsd',
  commit_template: null,
  versioning_scheme: 'semver',
  parallelization: true,
});

const WORKFLOW_DEFAULTS = Object.freeze({
  research: true,
  plan_check: true,
  verifier: true,
  nyquist_validation: true,
});

module.exports = { DEFAULTS, WORKFLOW_DEFAULTS };
