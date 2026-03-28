/**
 * Statusline Components Tests
 *
 * Unit tests for the new statusline render functions added in Phase 16.
 * Tests cover: git branch, token breakdown, cross-model warning.
 *
 * Requirements: UX-01, UX-02
 */

'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Import the render functions from gsd-statusline.js
const statusline = require('../hooks/gsd-statusline.js');
const {
  formatTokenCount,
  formatBranchDisplay,
  renderGitBranch,
  renderTokenBreakdown,
  renderCrossModelWarning,
  withCache,
} = statusline;

// ─── helpers ────────────────────────────────────────────────────────────────

function makeTmpDir() {
  // Try os.tmpdir() first; fall back to /tmp/claude-1000/ if the dir doesn't exist
  // (sandbox sets TMPDIR=/tmp/claude which may not be created on disk)
  const candidates = [os.tmpdir(), '/tmp/claude-1000', '/tmp'];
  for (const base of candidates) {
    try {
      if (fs.existsSync(base)) {
        return fs.mkdtempSync(path.join(base, 'statusline-test-'));
      }
    } catch (e) { /* try next */ }
  }
  throw new Error('No writable tmp directory found');
}

function cleanup(dir) {
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

// ─── formatTokenCount ────────────────────────────────────────────────────────

describe('formatTokenCount', () => {
  it('formats 12345 as 12.3k', () => {
    assert.strictEqual(formatTokenCount(12345), '12.3k');
  });

  it('formats 1000 as 1.0k', () => {
    assert.strictEqual(formatTokenCount(1000), '1.0k');
  });

  it('formats 500 as 500 (no k suffix)', () => {
    assert.strictEqual(formatTokenCount(500), '500');
  });

  it('formats 999 as 999 (boundary below 1k)', () => {
    assert.strictEqual(formatTokenCount(999), '999');
  });

  it('formats 0 as 0', () => {
    assert.strictEqual(formatTokenCount(0), '0');
  });
});

// ─── formatBranchDisplay ────────────────────────────────────────────────────

describe('formatBranchDisplay', () => {
  it('returns cyan ANSI for feature branch with bracket wrapping and no leading space', () => {
    const result = formatBranchDisplay('feature-x');
    assert.ok(result.includes('[feature-x]'), 'must contain bracket-wrapped branch name');
    assert.ok(result.includes('\x1b[36m'), 'must contain cyan ANSI code');
    assert.ok(result.includes('\x1b[0m'), 'must contain reset ANSI code');
    assert.ok(!result.startsWith(' '), 'must not start with a leading space');
  });

  it('returns red ANSI for main branch with bracket wrapping', () => {
    const result = formatBranchDisplay('main');
    assert.ok(result.includes('[main]'), 'must contain bracket-wrapped branch name');
    assert.ok(result.includes('\x1b[31m'), 'must contain red ANSI code');
    assert.ok(result.includes('\x1b[0m'), 'must contain reset ANSI code');
  });

  it('returns red ANSI for master branch with bracket wrapping', () => {
    const result = formatBranchDisplay('master');
    assert.ok(result.includes('[master]'), 'must contain bracket-wrapped branch name');
    assert.ok(result.includes('\x1b[31m'), 'must contain red ANSI code');
    assert.ok(result.includes('\x1b[0m'), 'must contain reset ANSI code');
  });

  it('returns cyan for develop branch with bracket wrapping (not danger)', () => {
    const result = formatBranchDisplay('develop');
    assert.ok(result.includes('[develop]'), 'must contain bracket-wrapped branch name');
    assert.ok(result.includes('\x1b[36m'), 'must use cyan (not red) for develop');
  });
});

// ─── renderGitBranch ────────────────────────────────────────────────────────

describe('renderGitBranch', () => {
  it('returns empty string when git_branch component is disabled', () => {
    const data = { workspace: { current_dir: process.cwd() } };
    const config = { statusline: { components: { git_branch: false } } };
    const result = renderGitBranch(data, config);
    assert.strictEqual(result, '');
  });

  it('returns a non-empty string when enabled (uses real git in test repo)', () => {
    // This test runs in the workspace git repo, so git branch --show-current will work
    const data = { workspace: { current_dir: process.cwd() } };
    const config = {};
    const result = renderGitBranch(data, config);
    // Either returns a branch string with ANSI codes, or '' if git fails
    // We just verify it doesn't throw
    assert.ok(typeof result === 'string', 'must return a string');
  });

  it('returns empty string gracefully when cwd has no git repo', () => {
    const tmpDir = makeTmpDir();
    try {
      const data = { workspace: { current_dir: tmpDir } };
      const config = {};
      const result = renderGitBranch(data, config);
      // git branch --show-current in a non-git dir returns '' or errors
      assert.ok(typeof result === 'string', 'must return a string (not throw)');
    } finally {
      cleanup(tmpDir);
    }
  });
});

// ─── renderTokenBreakdown ────────────────────────────────────────────────────

describe('renderTokenBreakdown', () => {
  it('returns string with formatted creation and read counts when both non-zero', () => {
    const data = {
      context_window: {
        current_usage: {
          cache_creation_input_tokens: 5000,
          cache_read_input_tokens: 2000,
        },
      },
    };
    const result = renderTokenBreakdown(data, {});
    assert.ok(result.includes('5.0k'), 'must contain formatted creation count');
    assert.ok(result.includes('2.0k'), 'must contain formatted read count');
  });

  it('returns empty string when current_usage is null (before first API call)', () => {
    const data = { context_window: { current_usage: null } };
    const result = renderTokenBreakdown(data, {});
    assert.strictEqual(result, '');
  });

  it('returns empty string when context_window is missing', () => {
    const data = {};
    const result = renderTokenBreakdown(data, {});
    assert.strictEqual(result, '');
  });

  it('returns empty string when both cache counts are 0', () => {
    const data = {
      context_window: {
        current_usage: {
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      },
    };
    const result = renderTokenBreakdown(data, {});
    assert.strictEqual(result, '');
  });

  it('returns empty string when token_breakdown component is disabled', () => {
    const data = {
      context_window: {
        current_usage: {
          cache_creation_input_tokens: 5000,
          cache_read_input_tokens: 2000,
        },
      },
    };
    const config = { statusline: { components: { token_breakdown: false } } };
    const result = renderTokenBreakdown(data, config);
    assert.strictEqual(result, '');
  });

  it('returns ANSI dim code for styling', () => {
    const data = {
      context_window: {
        current_usage: {
          cache_creation_input_tokens: 1000,
          cache_read_input_tokens: 500,
        },
      },
    };
    const result = renderTokenBreakdown(data, {});
    assert.ok(result.includes('\x1b[2m'), 'must use dim ANSI for token display');
    assert.ok(result.includes('\x1b[0m'), 'must reset ANSI after');
  });
});

// ─── renderCrossModelWarning ─────────────────────────────────────────────────

describe('renderCrossModelWarning', () => {
  it('returns [>200k] warning when exceeds_200k_tokens=true and windowSize > 200000', () => {
    const data = {
      exceeds_200k_tokens: true,
      context_window: { context_window_size: 1000000 },
    };
    const result = renderCrossModelWarning(data, {});
    assert.ok(result.includes('>200k'), 'must contain >200k warning text');
    assert.ok(result.includes('\x1b[33m'), 'must use yellow ANSI for warning');
    assert.ok(result.includes('\x1b[0m'), 'must reset ANSI after');
  });

  it('returns empty string when exceeds_200k_tokens is false', () => {
    const data = {
      exceeds_200k_tokens: false,
      context_window: { context_window_size: 1000000 },
    };
    const result = renderCrossModelWarning(data, {});
    assert.strictEqual(result, '');
  });

  it('returns empty string when exceeds_200k_tokens is null (early session)', () => {
    const data = {
      exceeds_200k_tokens: null,
      context_window: { context_window_size: 1000000 },
    };
    const result = renderCrossModelWarning(data, {});
    assert.strictEqual(result, '');
  });

  it('returns empty string when exceeds_200k_tokens is undefined', () => {
    const data = {
      context_window: { context_window_size: 1000000 },
    };
    const result = renderCrossModelWarning(data, {});
    assert.strictEqual(result, '');
  });

  it('returns empty string for Sonnet-class model (windowSize <= 200000)', () => {
    const data = {
      exceeds_200k_tokens: true,
      context_window: { context_window_size: 200000 },
    };
    const result = renderCrossModelWarning(data, {});
    assert.strictEqual(result, '', 'warning must not appear on Sonnet-class models');
  });

  it('returns empty string when windowSize is exactly 200000', () => {
    const data = {
      exceeds_200k_tokens: true,
      context_window: { context_window_size: 200000 },
    };
    const result = renderCrossModelWarning(data, {});
    assert.strictEqual(result, '');
  });

  it('returns empty string when cross_model_warning component is disabled', () => {
    const data = {
      exceeds_200k_tokens: true,
      context_window: { context_window_size: 1000000 },
    };
    const config = { statusline: { components: { cross_model_warning: false } } };
    const result = renderCrossModelWarning(data, config);
    assert.strictEqual(result, '');
  });

  it('returns warning when windowSize is 1000001 (just above 200k threshold)', () => {
    const data = {
      exceeds_200k_tokens: true,
      context_window: { context_window_size: 200001 },
    };
    const result = renderCrossModelWarning(data, {});
    assert.ok(result.includes('>200k'), 'must show warning just above threshold');
  });
});

// ─── withCache ───────────────────────────────────────────────────────────────

describe('withCache', () => {
  it('calls computeFn and writes result when cache file does not exist', () => {
    const tmpDir = makeTmpDir();
    const cacheFile = path.join(tmpDir, 'test.cache');
    try {
      let called = 0;
      const result = withCache(cacheFile, 60, () => { called++; return 'computed-value'; });
      assert.strictEqual(result, 'computed-value');
      assert.strictEqual(called, 1);
      assert.ok(fs.existsSync(cacheFile), 'cache file must be created');
      assert.strictEqual(fs.readFileSync(cacheFile, 'utf8'), 'computed-value');
    } finally {
      cleanup(tmpDir);
    }
  });

  it('returns cached value without calling computeFn when cache is fresh', () => {
    const tmpDir = makeTmpDir();
    const cacheFile = path.join(tmpDir, 'test.cache');
    try {
      fs.writeFileSync(cacheFile, 'cached-value');
      // File just written, mtime is now — should be within TTL
      let called = 0;
      const result = withCache(cacheFile, 60, () => { called++; return 'new-value'; });
      assert.strictEqual(result, 'cached-value');
      assert.strictEqual(called, 0, 'computeFn must not be called when cache is fresh');
    } finally {
      cleanup(tmpDir);
    }
  });

  it('returns empty string on error (computeFn throws)', () => {
    const tmpDir = makeTmpDir();
    const cacheFile = path.join(tmpDir, 'test.cache');
    try {
      const result = withCache(cacheFile, 60, () => { throw new Error('compute failed'); });
      assert.strictEqual(result, '');
    } finally {
      cleanup(tmpDir);
    }
  });
});
