'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { runGsdTools, createTempProject, cleanup } = require('./helpers.cjs');

const STATE = `# Project State

## Current Position

**Current Phase:** 03
**Status:** Planning
**Current Plan:** 03-01
**Last Activity:** 2026-01-01
**Last Activity Description:** Earlier

### Decisions

None yet.

### Blockers/Concerns

- Original blocker

## Session Continuity

**Last session:** 2026-01-01
**Stopped At:** Earlier
**Resume File:** None

### Quick Tasks Completed

| # | Description | Date | Commit | Status | Directory |
|---|-------------|------|--------|--------|-----------|
`;
const FRONTMATTER = '---\nphase: 01\ntags:\n  - first\n---\nBody\n';

function project(fn) {
  const cwd = createTempProject();
  const state = path.join(cwd, '.planning', 'STATE.md');
  const file = path.join(cwd, 'entry.md');
  const source = path.join(cwd, 'input.txt');
  fs.writeFileSync(state, STATE);
  fs.writeFileSync(file, FRONTMATTER);
  fs.writeFileSync(source, 'From file\n');
  try { fn({ cwd, state, file, source }); } finally { cleanup(cwd); }
}

function rejected(cwd, argv, flag, command, unchanged = []) {
  const before = unchanged.map((file) => fs.readFileSync(file));
  const result = runGsdTools(argv, cwd);
  assert.equal(result.success, false, `${argv.join(' ')} should fail; got ${result.output}`);
  assert.match(result.error, new RegExp(flag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(result.error, new RegExp(command));
  assert.equal(result.output, '', 'rejection must not select an output property');
  unchanged.forEach((file, index) => assert.deepEqual(fs.readFileSync(file), before[index], `${file} changed`));
}

const selectors = [
  ['detect-platform', 'platform'],
  ['detect-workspace', 'type'],
  ['git-context', 'branch'],
  ['ssh-check', 'is_ssh'],
];
for (const [command, field] of selectors) {
  test(`${command} rejects both kinds of repeated --field and keeps selectors`, () => project(({ cwd }) => {
    for (const other of ['other', field]) {
      rejected(cwd, [command, '--field', field, '--field', other], '--field', command);
    }
    assert.equal(runGsdTools([command, '--field', field], cwd).success, true);
    assert.equal(runGsdTools([command], cwd).success, true);
  }));
}

test('frontmatter get validates each scalar and retains missing and empty defaults', () => project(({ cwd, file }) => {
  for (const [flag, first, second] of [['--field', 'phase', 'tags'], ['--format', 'json', 'yaml'], ['--default', 'fallback', 'other']]) {
    const base = ['frontmatter', 'get', file];
    if (flag !== '--field') base.push('--field', 'phase');
    if (flag === '--default') base.splice(base.length - 2, 2, '--field', 'missing');
    for (const other of [second, first]) rejected(cwd, [...base, flag, first, flag, other], flag, 'frontmatter get', [file]);
  }
  const absent = runGsdTools(['frontmatter', 'get', file, '--field', 'missing', '--json'], cwd);
  assert.equal(absent.success, true);
  assert.match(absent.output, /Field not found/);
  const empty = runGsdTools(['frontmatter', 'get', file, '--field', 'missing', '--default', ''], cwd);
  assert.equal(empty.success, true);
  assert.equal(empty.output, '');
  assert.equal(runGsdTools(['frontmatter', 'get', file, '--field', 'phase'], cwd).success, true);
}));

const writers = [
  ['record-metric', ['--phase', '03', '--plan', '01', '--duration', '2min', '--tasks', '2', '--files', '3']],
  ['add-decision', ['--phase', '03', '--summary', 'Inline', '--summary-file', 'INPUT', '--rationale', 'Inline rationale', '--rationale-file', 'INPUT']],
  ['add-blocker', ['--text', 'Inline', '--text-file', 'INPUT']],
  ['resolve-blocker', ['--text', 'Original blocker']],
  ['record-session', ['--stopped-at', 'Stopped', '--resume-file', 'None']],
  ['begin-phase', ['--phase', '04', '--name', 'Fourth', '--plans', '2']],
  ['record-quick-task', ['--id', '260929-abc', '--description', 'Inline', '--description-file', 'INPUT', '--date', '2026-09-29', '--commit', 'abc123', '--dir', 'quick-task', '--status', 'Done']],
];
for (const [command, pairs] of writers) {
  for (let i = 0; i < pairs.length; i += 2) {
    const flag = pairs[i];
    test(`state ${command} rejects repeated ${flag} before writing`, () => project(({ cwd, state, file, source }) => {
      const base = pairs.map((value) => value === 'INPUT' ? source : value);
      for (const other of ['different', base[i + 1]]) {
        rejected(cwd, ['state', command, ...base, flag, other], flag, `state ${command}`, [state, file, source]);
      }
    }));
  }
}

for (const command of ['set', 'array-append']) {
  for (const flag of ['--field', '--value']) {
    test(`frontmatter ${command} rejects repeated ${flag} without writing`, () => project(({ cwd, file }) => {
      const base = ['frontmatter', command, file, '--field', 'tags', '--value', '"new"'];
      for (const other of [flag === '--field' ? 'phase' : '"other"', flag === '--field' ? 'tags' : '"new"']) {
        rejected(cwd, [...base, flag, other], flag, `frontmatter ${command}`, [file]);
      }
    }));
  }
}

test('frontmatter singleton JSON values and explicit empty value survive', () => project(({ cwd, file }) => {
  assert.equal(runGsdTools(['frontmatter', 'set', file, '--field', 'tags', '--value', '["a","b"]'], cwd).success, true);
  assert.match(fs.readFileSync(file, 'utf8'), /tags: \[a, b\]/);
  assert.equal(runGsdTools(['frontmatter', 'array-append', file, '--field', 'tags', '--value', '"c"'], cwd).success, true);
  assert.match(fs.readFileSync(file, 'utf8'), /tags: \[a, b, "c"\]/);
  assert.equal(runGsdTools(['frontmatter', 'set', file, '--field', 'phase', '--value', ''], cwd).success, true);
}));

test('state patch rejects dynamic keys and repeated named scalars without writing', () => project(({ cwd, state, file }) => {
  for (const tail of [['--Status', 'X'], ['--Current Plan', 'X'], ['--Status', 'X', '--Current Plan', 'Y']]) {
    const before = fs.readFileSync(state);
    const result = runGsdTools(['state', 'patch', ...tail], cwd);
    assert.equal(result.success, false, `legacy patch accepted: ${result.output}`);
    assert.match(result.error, /Unknown flag|unsupported/i);
    assert.deepEqual(fs.readFileSync(state), before);
  }
  for (const [flag, value] of [['--field', 'Other'], ['--field', 'Status'], ['--value', 'Y'], ['--value', 'X']]) {
    rejected(cwd, ['state', 'patch', '--field', 'Status', '--value', 'X', flag, value], flag, 'state patch', [state, file]);
  }
  for (const [field, value] of [['', 'X'], ['Status', '']]) {
    const before = fs.readFileSync(state);
    const result = runGsdTools(['state', 'patch', '--field', field, '--value', value], cwd);
    assert.equal(result.success, false, 'empty named patch input must remain invalid');
    assert.match(result.error, /--field and --value require arguments/);
    assert.deepEqual(fs.readFileSync(state), before);
  }
  for (const [field, value] of [['Status', 'X'], ['Current Plan', '03-02']]) {
    assert.equal(runGsdTools(['state', 'patch', '--field', field, '--value', value], cwd).success, true);
  }
  assert.match(fs.readFileSync(state, 'utf8'), /\*\*Status:\*\* X/);
  assert.match(fs.readFileSync(state, 'utf8'), /\*\*Current Plan:\*\* 03-02/);
}));

test('named state patch accepts an equals-containing value', () => project(({ cwd, state }) => {
  const result = runGsdTools(['state', 'patch', '--field', 'Status', '--value', 'build=green'], cwd);
  assert.equal(result.success, true, result.error);
  assert.match(fs.readFileSync(state, 'utf8'), /\*\*Status:\*\* build=green/);
}));

for (const [command, inline, fileFlag, expected] of [
  ['add-decision', '--summary', '--summary-file', /\[Phase 03\]: From file/],
  ['add-blocker', '--text', '--text-file', /- From file/],
  ['record-quick-task', '--description', '--description-file', /From file/],
]) {
  test(`state ${command} honors ${fileFlag} before and after ${inline}`, () => project(({ cwd, state, source }) => {
    for (const reversed of [false, true]) {
      fs.writeFileSync(state, STATE);
      const alternate = reversed ? [fileFlag, source, inline, 'Inline'] : [inline, 'Inline', fileFlag, source];
      const required = command === 'add-decision' ? ['--phase', '03'] : command === 'record-quick-task' ? ['--id', '260929-abc'] : [];
      const result = runGsdTools(['state', command, ...required, ...alternate], cwd);
      assert.equal(result.success, true, result.error);
      assert.match(fs.readFileSync(state, 'utf8'), expected);
      assert.doesNotMatch(fs.readFileSync(state, 'utf8'), /Inline/);
    }
  }));
}

test('decision rationale file wins in either order; omitted optional fields remain valid', () => project(({ cwd, state, source }) => {
  for (const reversed of [false, true]) {
    fs.writeFileSync(state, STATE);
    const pair = reversed ? ['--rationale-file', source, '--rationale', 'Inline rationale'] : ['--rationale', 'Inline rationale', '--rationale-file', source];
    const result = runGsdTools(['state', 'add-decision', '--summary', 'Decision', ...pair], cwd);
    assert.equal(result.success, true, result.error);
    assert.match(fs.readFileSync(state, 'utf8'), /Decision — From file/);
    assert.doesNotMatch(fs.readFileSync(state, 'utf8'), /Inline rationale/);
  }
  assert.equal(runGsdTools(['state', 'add-decision', '--summary', 'No rationale'], cwd).success, true);
  assert.equal(runGsdTools(['state', 'record-session', '--stopped-at', 'Done'], cwd).success, true);
  assert.match(fs.readFileSync(state, 'utf8'), /\*\*Resume File:\*\* None/);
  assert.equal(runGsdTools(['state', 'add-blocker', '--text', ''], cwd).success, true);
}));
