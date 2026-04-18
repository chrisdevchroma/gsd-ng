'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const {
  getPlatformCliPatterns,
  getAllPlatformCliPatterns,
  CLI_SUBCOMMANDS,
  PLATFORM_TO_CLI,
} = require(path.resolve(__dirname, '..', 'gsd-ng', 'bin', 'lib', 'allowlist.cjs'));

// ── ALLOW-01: getPlatformCliPatterns('gh') returns patterns for all 6 subcommands ──

describe('ALLOW-01: getPlatformCliPatterns(gh) returns patterns for all 6 subcommands', () => {
  test('returns 12 patterns (2 per subcommand x 6 subcommands)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.strictEqual(patterns.length, 12, `Expected 12 patterns, got ${patterns.length}`);
  });

  test('includes Bash(gh pr *) and Bash(gh pr)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.ok(patterns.includes('Bash(gh pr *)'), 'Missing Bash(gh pr *)');
    assert.ok(patterns.includes('Bash(gh pr)'), 'Missing Bash(gh pr)');
  });

  test('includes Bash(gh issue *) and Bash(gh issue)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.ok(patterns.includes('Bash(gh issue *)'), 'Missing Bash(gh issue *)');
    assert.ok(patterns.includes('Bash(gh issue)'), 'Missing Bash(gh issue)');
  });

  test('includes Bash(gh release *) and Bash(gh release)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.ok(patterns.includes('Bash(gh release *)'), 'Missing Bash(gh release *)');
    assert.ok(patterns.includes('Bash(gh release)'), 'Missing Bash(gh release)');
  });

  test('includes Bash(gh workflow *) and Bash(gh workflow)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.ok(patterns.includes('Bash(gh workflow *)'), 'Missing Bash(gh workflow *)');
    assert.ok(patterns.includes('Bash(gh workflow)'), 'Missing Bash(gh workflow)');
  });

  test('includes Bash(gh auth *) and Bash(gh auth)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.ok(patterns.includes('Bash(gh auth *)'), 'Missing Bash(gh auth *)');
    assert.ok(patterns.includes('Bash(gh auth)'), 'Missing Bash(gh auth)');
  });

  test('includes Bash(gh repo *) and Bash(gh repo)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.ok(patterns.includes('Bash(gh repo *)'), 'Missing Bash(gh repo *)');
    assert.ok(patterns.includes('Bash(gh repo)'), 'Missing Bash(gh repo)');
  });
});

// ── ALLOW-02: getPlatformCliPatterns('gh') does NOT include api or extension ──

describe('ALLOW-02: getPlatformCliPatterns(gh) does NOT include api or extension', () => {
  test('does not include Bash(gh api *)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.ok(!patterns.includes('Bash(gh api *)'), 'Must NOT include Bash(gh api *)');
  });

  test('does not include Bash(gh api)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.ok(!patterns.includes('Bash(gh api)'), 'Must NOT include Bash(gh api)');
  });

  test('does not include Bash(gh extension *)', () => {
    const patterns = getPlatformCliPatterns('gh');
    assert.ok(!patterns.includes('Bash(gh extension *)'), 'Must NOT include Bash(gh extension *)');
  });
});

// ── ALLOW-03: getPlatformCliPatterns('tea') returns patterns for both canonical and alias forms ──

describe('ALLOW-03: getPlatformCliPatterns(tea) returns patterns for canonical and alias forms', () => {
  test('includes Bash(tea pr *) canonical form', () => {
    const patterns = getPlatformCliPatterns('tea');
    assert.ok(patterns.includes('Bash(tea pr *)'), 'Missing Bash(tea pr *)');
    assert.ok(patterns.includes('Bash(tea pr)'), 'Missing Bash(tea pr)');
  });

  test('includes Bash(tea pulls *) alias form', () => {
    const patterns = getPlatformCliPatterns('tea');
    assert.ok(patterns.includes('Bash(tea pulls *)'), 'Missing Bash(tea pulls *)');
    assert.ok(patterns.includes('Bash(tea pulls)'), 'Missing Bash(tea pulls)');
  });

  test('includes Bash(tea issue *) canonical form', () => {
    const patterns = getPlatformCliPatterns('tea');
    assert.ok(patterns.includes('Bash(tea issue *)'), 'Missing Bash(tea issue *)');
  });

  test('includes Bash(tea issues *) alias form', () => {
    const patterns = getPlatformCliPatterns('tea');
    assert.ok(patterns.includes('Bash(tea issues *)'), 'Missing Bash(tea issues *)');
  });

  test('includes Bash(tea release *) canonical form', () => {
    const patterns = getPlatformCliPatterns('tea');
    assert.ok(patterns.includes('Bash(tea release *)'), 'Missing Bash(tea release *)');
  });

  test('includes Bash(tea releases *) alias form', () => {
    const patterns = getPlatformCliPatterns('tea');
    assert.ok(patterns.includes('Bash(tea releases *)'), 'Missing Bash(tea releases *)');
  });

  test('includes Bash(tea repo *) canonical form', () => {
    const patterns = getPlatformCliPatterns('tea');
    assert.ok(patterns.includes('Bash(tea repo *)'), 'Missing Bash(tea repo *)');
  });

  test('includes Bash(tea repos *) alias form', () => {
    const patterns = getPlatformCliPatterns('tea');
    assert.ok(patterns.includes('Bash(tea repos *)'), 'Missing Bash(tea repos *)');
  });

  test('includes Bash(tea login *) and Bash(tea login)', () => {
    const patterns = getPlatformCliPatterns('tea');
    assert.ok(patterns.includes('Bash(tea login *)'), 'Missing Bash(tea login *)');
    assert.ok(patterns.includes('Bash(tea login)'), 'Missing Bash(tea login)');
  });
});

// ── ALLOW-04: getPlatformCliPatterns('unknown') returns empty array ──

describe('ALLOW-04: getPlatformCliPatterns(unknown) returns empty array', () => {
  test('returns empty array for unknown CLI', () => {
    const patterns = getPlatformCliPatterns('unknown');
    assert.ok(Array.isArray(patterns), 'Result must be an array');
    assert.strictEqual(patterns.length, 0, 'Result must be empty for unknown CLI');
  });

  test('returns empty array for empty string', () => {
    const patterns = getPlatformCliPatterns('');
    assert.ok(Array.isArray(patterns), 'Result must be an array');
    assert.strictEqual(patterns.length, 0, 'Result must be empty for empty string');
  });
});

// ── ALLOW-05: getAllPlatformCliPatterns returns object with keys for all 4 CLIs ──

describe('ALLOW-05: getAllPlatformCliPatterns returns object with keys for all 4 CLIs', () => {
  test('returns object with gh, glab, fj, tea keys', () => {
    const all = getAllPlatformCliPatterns();
    assert.ok(typeof all === 'object' && all !== null, 'Result must be an object');
    assert.ok('gh' in all, 'Must have gh key');
    assert.ok('glab' in all, 'Must have glab key');
    assert.ok('fj' in all, 'Must have fj key');
    assert.ok('tea' in all, 'Must have tea key');
  });

  test('each value is a non-empty array of strings', () => {
    const all = getAllPlatformCliPatterns();
    for (const [cli, patterns] of Object.entries(all)) {
      assert.ok(Array.isArray(patterns), `${cli} patterns must be an array`);
      assert.ok(patterns.length > 0, `${cli} must have at least one pattern`);
    }
  });
});

// ── ALLOW-06: PLATFORM_TO_CLI maps platform names to CLI binaries ──

describe('ALLOW-06: PLATFORM_TO_CLI maps platform names to CLI binaries', () => {
  test('github maps to gh', () => {
    assert.strictEqual(PLATFORM_TO_CLI['github'], 'gh');
  });

  test('gitlab maps to glab', () => {
    assert.strictEqual(PLATFORM_TO_CLI['gitlab'], 'glab');
  });

  test('forgejo maps to fj', () => {
    assert.strictEqual(PLATFORM_TO_CLI['forgejo'], 'fj');
  });

  test('gitea maps to tea', () => {
    assert.strictEqual(PLATFORM_TO_CLI['gitea'], 'tea');
  });
});

// ── ALLOW-07: every pattern starts with 'Bash(' and ends with ')' ──

describe('ALLOW-07: every pattern starts with Bash( and ends with )', () => {
  test('all gh patterns have correct format', () => {
    const patterns = getPlatformCliPatterns('gh');
    for (const p of patterns) {
      assert.ok(p.startsWith('Bash('), `Pattern "${p}" must start with Bash(`);
      assert.ok(p.endsWith(')'), `Pattern "${p}" must end with )`);
    }
  });

  test('all glab patterns have correct format', () => {
    const patterns = getPlatformCliPatterns('glab');
    for (const p of patterns) {
      assert.ok(p.startsWith('Bash('), `Pattern "${p}" must start with Bash(`);
      assert.ok(p.endsWith(')'), `Pattern "${p}" must end with )`);
    }
  });

  test('all fj patterns have correct format', () => {
    const patterns = getPlatformCliPatterns('fj');
    for (const p of patterns) {
      assert.ok(p.startsWith('Bash('), `Pattern "${p}" must start with Bash(`);
      assert.ok(p.endsWith(')'), `Pattern "${p}" must end with )`);
    }
  });

  test('all tea patterns have correct format', () => {
    const patterns = getPlatformCliPatterns('tea');
    for (const p of patterns) {
      assert.ok(p.startsWith('Bash('), `Pattern "${p}" must start with Bash(`);
      assert.ok(p.endsWith(')'), `Pattern "${p}" must end with )`);
    }
  });

  test('getAllPlatformCliPatterns all entries have correct format', () => {
    const all = getAllPlatformCliPatterns();
    for (const [cli, patterns] of Object.entries(all)) {
      for (const p of patterns) {
        assert.ok(p.startsWith('Bash('), `${cli} pattern "${p}" must start with Bash(`);
        assert.ok(p.endsWith(')'), `${cli} pattern "${p}" must end with )`);
      }
    }
  });
});
