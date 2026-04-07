'use strict';

/**
 * GSD Tools Tests - defaults.cjs
 *
 * Tests for the centralized defaults module ensuring all default values
 * match canonical sources, objects are frozen, and no circular imports exist.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const { DEFAULTS, WORKFLOW_DEFAULTS } = require('../gsd-ng/bin/lib/defaults.cjs');

describe('defaults.cjs', () => {
  describe('DEFAULTS values', () => {
    test('model_profile is balanced', () => {
      assert.strictEqual(DEFAULTS.model_profile, 'balanced');
    });

    test('commit_docs is true', () => {
      assert.strictEqual(DEFAULTS.commit_docs, true);
    });

    test('search_gitignored is false', () => {
      assert.strictEqual(DEFAULTS.search_gitignored, false);
    });

    test('branching_strategy is none', () => {
      assert.strictEqual(DEFAULTS.branching_strategy, 'none');
    });

    test('phase_branch_template has gsd/ prefix', () => {
      assert.strictEqual(DEFAULTS.phase_branch_template, 'gsd/phase-{phase}-{slug}');
    });

    test('milestone_branch_template has gsd/ prefix', () => {
      assert.strictEqual(DEFAULTS.milestone_branch_template, 'gsd/{milestone}-{slug}');
    });

    test('target_branch is main', () => {
      assert.strictEqual(DEFAULTS.target_branch, 'main');
    });

    test('auto_push is false', () => {
      assert.strictEqual(DEFAULTS.auto_push, false);
    });

    test('remote is origin', () => {
      assert.strictEqual(DEFAULTS.remote, 'origin');
    });

    test('review_branch_template uses type/phase-slug pattern', () => {
      assert.strictEqual(DEFAULTS.review_branch_template, '{type}/{phase}-{slug}');
    });

    test('pr_draft is true', () => {
      assert.strictEqual(DEFAULTS.pr_draft, true);
    });

    test('platform is null', () => {
      assert.strictEqual(DEFAULTS.platform, null);
    });

    test('commit_format is gsd', () => {
      assert.strictEqual(DEFAULTS.commit_format, 'gsd');
    });

    test('commit_template is null', () => {
      assert.strictEqual(DEFAULTS.commit_template, null);
    });

    test('versioning_scheme is semver', () => {
      assert.strictEqual(DEFAULTS.versioning_scheme, 'semver');
    });

    test('parallelization is true', () => {
      assert.strictEqual(DEFAULTS.parallelization, true);
    });
  });

  describe('WORKFLOW_DEFAULTS values', () => {
    test('research is true', () => {
      assert.strictEqual(WORKFLOW_DEFAULTS.research, true);
    });

    test('plan_check is true', () => {
      assert.strictEqual(WORKFLOW_DEFAULTS.plan_check, true);
    });

    test('verifier is true', () => {
      assert.strictEqual(WORKFLOW_DEFAULTS.verifier, true);
    });

    test('nyquist_validation is true', () => {
      assert.strictEqual(WORKFLOW_DEFAULTS.nyquist_validation, true);
    });
  });

  describe('module safety', () => {
    test('DEFAULTS object is frozen', () => {
      assert.strictEqual(Object.isFrozen(DEFAULTS), true);
    });

    test('WORKFLOW_DEFAULTS object is frozen', () => {
      assert.strictEqual(Object.isFrozen(WORKFLOW_DEFAULTS), true);
    });

    test('defaults.cjs has no internal lib imports (no circular deps)', () => {
      const source = fs.readFileSync(
        path.join(__dirname, '..', 'gsd-ng', 'bin', 'lib', 'defaults.cjs'),
        'utf-8'
      );
      const forbidden = [
        "require('./core",
        "require('./config",
        "require('./init",
        "require('./workspace",
        "require('./verify",
      ];
      for (const pattern of forbidden) {
        assert.strictEqual(
          source.includes(pattern),
          false,
          `defaults.cjs must not import ${pattern}`
        );
      }
    });
  });
});
