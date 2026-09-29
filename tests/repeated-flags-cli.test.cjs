'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { runGsdTools, createTempProject, createTempGitProject, cleanup } = require('./helpers.cjs');
function fixture(fn, git = false) {
  const cwd = git ? createTempGitProject() : createTempProject();
  const file = path.join(cwd, 'entry.md');
  fs.writeFileSync(file, '---\nphase: 01\nname: Original\n---\nBody\n');
  fs.writeFileSync(path.join(cwd, '.planning', 'ROADMAP.md'), '# Roadmap\n\n## Phase 01: Sample\n\nText\n');
  fs.mkdirSync(path.join(cwd, '.planning', 'phases', '01-sample'));
  fs.writeFileSync(path.join(cwd, '.planning', 'STATE.md'), '# State\n\n## Current Position\n\n**Current Phase:** 01\n\n### Quick Tasks Completed\n\n| # | Description | Date | Commit | Status | Directory |\n|---|---|---|---|---|---|---|\n');
  fs.writeFileSync(path.join(cwd, '.planning', 'config.json'), '{"commit_docs":true}');
  const tmp = fs.mkdtempSync(path.join(cwd, 'isolated-'));
  const calls = path.join(tmp, 'calls');
  fs.writeFileSync(calls, '');
  const preload = path.join(tmp, 'network.cjs');
  fs.writeFileSync(preload, "globalThis.fetch=async()=>{require('node:fs').appendFileSync(process.env.NETWORK_CALLS,'fetch\\n');return {ok:true,json:async()=>({web:{results:[]}})}};\n");
  const run = argv => runGsdTools(argv, cwd, { TMPDIR: tmp, NODE_OPTIONS: `--require=${preload}`, NETWORK_CALLS: calls, BRAVE_API_KEY: 'dummy', GSD_TEST_MODE: '1' });
  try { fn({ cwd, file, tmp, calls, run }); } finally { cleanup(cwd); }
}
function tree(dir) {
  const result = {};
  function visit(p) {
    for (const item of fs.readdirSync(p, { withFileTypes: true })) {
      const full = path.join(p, item.name);
      if (item.isDirectory()) visit(full);
      else if (item.isFile()) result[path.relative(dir, full)] = fs.readFileSync(full).toString('base64');
    }
  }
  visit(dir);
  return result;
}
function duplicate(ctx, argv, label, flag, git = false) {
  const before = tree(ctx.cwd);
  const head = git ? execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.cwd, encoding: 'utf8' }) : null;
  const index = git ? execFileSync('git', ['ls-files', '-s'], { cwd: ctx.cwd, encoding: 'utf8' }) : null;
  const result = ctx.run(argv);
  assert.equal(result.success, false, `accepted ${argv.join(' ')}: ${result.output}`);
  assert.equal(result.output, '');
  assert.match(result.error, new RegExp(`${flag} was given 2 times`), result.error);
  if (label) assert.ok(result.error.includes(`'${label}'`), result.error);
  assert.deepEqual(tree(ctx.cwd), before, `changed files on ${argv.join(' ')}`);
  if (git) {
    assert.equal(execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ctx.cwd, encoding: 'utf8' }), head);
    assert.equal(execFileSync('git', ['ls-files', '-s'], { cwd: ctx.cwd, encoding: 'utf8' }), index);
  }
}
const rows = [
  ['sync-agents', ['sync-agents'], '--agents-dir', 'agents-a'],
  ['verify-summary', ['verify-summary', 'entry.md'], '--check-count', '2'],
  ...['--phase','--plan','--name','--type','--wave','--fields'].map(flag => ['template fill', ['template','fill','summary','--phase','01'], flag, flag === '--fields' ? '{"tags":["a","b"]}' : flag === '--type' ? 'execute' : flag === '--wave' ? '1' : '01']),
  ['frontmatter merge', ['frontmatter','merge','entry.md'], '--data', '{"name":"One"}'],
  ['frontmatter validate', ['frontmatter','validate','entry.md'], '--schema', 'plan'],
  ['config-get', ['config-get','missing'], '--default', 'one'],
  ['roadmap get-phase', ['roadmap','get-phase','77'], '--default', 'one'],
  ['summary-extract', ['summary-extract','entry.md'], '--default', 'one'],
  ['phases list', ['phases','list'], '--type', 'main'],
  ['phases list', ['phases','list'], '--phase', '01'],
  ['websearch', ['websearch','test'], '--limit', '2'],
  ['websearch', ['websearch','test'], '--freshness', 'week'],
  ['squash', ['squash','01','--dry-run'], '--strategy', 'single'],
  ...['--level','--scheme','--field'].map(flag => ['version-bump', ['version-bump'], flag, flag === '--level' ? 'patch' : flag === '--scheme' ? 'semver' : 'version']),
  ['generate-changelog', ['generate-changelog','v1.0'], '--date', '2026-01-01'],
  ['generate-allowlist', ['generate-allowlist'], '--platform', 'linux'],
  ['issue-import', ['issue-import','github','42'], '--repo', 'example/project'],
  ['pingpong-check', ['pingpong-check'], '--window', '4'],
  ['breakout-check', ['breakout-check'], '--plan', '01-01'],
  ['scaffold', ['scaffold','phase-dir','--name','Sample'], '--phase', '01'],
];
assert.equal(rows.length, 27);
for (const [label, base, flag, value] of rows) {
  test(`${label} rejects repeated ${flag}`, () => fixture(ctx => {
    const initial = base.includes(flag) ? base : [...base, flag, value];
    for (const second of [value, flag === '--fields' || flag === '--data' ? '{"name":"Other"}' : 'different']) duplicate(ctx, [...initial, flag, second], label, flag);
    assert.equal(fs.readFileSync(ctx.calls, 'utf8'), '', 'duplicate fetched network');
  }));
}
test('scalar singleton, omitted, empty, numeric, JSON and network stub controls', () => fixture(ctx => {
  const run = ctx.run;
  assert.equal(run(['config-get','missing','--default','']).output, '');
  assert.equal(run(['config-get','commit_docs']).success, true);
  assert.equal(run(['config-get','missing']).success, false);
  assert.equal(run(['verify-summary','entry.md','--check-count','0']).success, true);
  assert.equal(run(['verify-summary','entry.md']).success, true);
  assert.equal(run(['websearch','query','--limit','3','--freshness','week']).success, true);
  assert.equal(fs.readFileSync(ctx.calls, 'utf8'), 'fetch\n');
  assert.equal(run(['frontmatter','merge',ctx.file,'--data','{"name":"A,B"}']).success, true);
  assert.match(fs.readFileSync(ctx.file, 'utf8'), /A,B/);
  assert.equal(run(['template','fill','summary','--phase','01','--fields','{"tags":["a","b"]}']).success, true);
  assert.equal(run(['generate-allowlist','--platform','']).success, true);
  assert.equal(run(['generate-allowlist']).success, true);
  assert.equal(run(['pingpong-check','--window','2']).success, true);
  assert.equal(run(['pingpong-check']).success, true);
  assert.equal(run(['issue-import','github','42','--repo','example/project']).success, true);
  assert.equal(run(['phases','list']).success, true);
}));
test('multiword names reject repetition, preserve words and optional flags', () => fixture(ctx => {
  for (const words of [['One','Two'], ['One Two'], ['']]) {
    duplicate(ctx, ['milestone','complete','v1','--name',...words,'--archive-phases','--name',...words], 'milestone complete', '--name');
    duplicate(ctx, ['scaffold','phase-dir','--name',...words,'--phase','01','--name',...words], 'scaffold', '--name');
  }
  assert.equal(ctx.run(['scaffold','phase-dir','--phase','01','--name','Two','Words']).success, true);
  assert.equal(ctx.run(['scaffold','phase-dir','--name','Three Words','--phase','02']).success, true);
  assert.equal(ctx.run(['milestone','complete','v1','--name','Some','Release','--archive-phases']).success, true);
}));
test('commit delimiter rejects repeat before staging; single marker commits exactly named paths and amend works', () => fixture(ctx => {
  for (const name of ['one.md','two.md','three.md']) fs.writeFileSync(path.join(ctx.cwd, name), name);
  duplicate(ctx, ['commit','safe','--files','one.md','--files','two.md'], 'commit', '--files', true);
  const result = ctx.run(['commit','safe','--files','one.md','two.md']);
  assert.equal(result.success, true, result.error);
  assert.deepEqual(execFileSync('git', ['show','--format=','--name-only','HEAD'], { cwd: ctx.cwd, encoding: 'utf8' }).trim().split('\n'), ['one.md','two.md']);
  assert.match(execFileSync('git', ['status','--short'], { cwd: ctx.cwd, encoding: 'utf8' }), /three\.md/);
  fs.writeFileSync(path.join(ctx.cwd, 'one.md'), 'amended');
  assert.equal(ctx.run(['commit','--amend','--files','one.md']).success, true);
}, true));
test('cwd same, mixed, identical, different and both placements reject named count', () => fixture(ctx => {
  const c = ctx.cwd;
  for (const pair of [['--cwd',c,'--cwd',c], ['--cwd',c,'--cwd',ctx.tmp], [`--cwd=${c}`,`--cwd=${c}`], [`--cwd=${c}`,`--cwd=${ctx.tmp}`], ['--cwd',c,`--cwd=${c}`], [`--cwd=${c}`,'--cwd',c]]) {
    duplicate(ctx, [...pair,'config-get','missing','--default','fallback'], null, '--cwd');
    duplicate(ctx, ['config-get','missing',...pair,'--default','fallback'], null, '--cwd');
  }
  assert.equal(ctx.run(['--cwd',c,'config-get','missing','--default','fallback']).output, 'fallback');
  assert.equal(ctx.run(['config-get','missing',`--cwd=${c}`,'--default','fallback']).output, 'fallback');
}));
test('pick duplicates before schema, output interception or help; help bypasses command duplicates', () => fixture(ctx => {
  for (const pair of [['--pick','found','--pick','found'], ['--pick','found','--pick','other']]) {
    duplicate(ctx, [...pair,'find-phase','01'], null, '--pick');
    duplicate(ctx, ['find-phase','01',...pair], null, '--pick');
    duplicate(ctx, ['--help',...pair], null, '--pick');
  }
  duplicate(ctx, ['--help','--cwd',ctx.cwd,`--cwd=${ctx.cwd}`], null, '--cwd');
  assert.equal(ctx.run(['find-phase','01','--pick','found']).success, true);
  assert.equal(ctx.run(['--pick','found','find-phase','01']).success, true);
  assert.equal(ctx.run(['--help','config-get','missing','--default','a','--default','b']).success, true);
}));
test('json/file repeats and quick verify are idempotent; file output cleaned', () => fixture(ctx => {
  assert.equal(ctx.run(['--json','--json','find-phase','01']).success, true);
  const file = ctx.run(['--file','--file','--json','find-phase','01']);
  assert.equal(file.success, true, file.error);
  assert.match(file.output, /^@file:/);
  assert.equal(JSON.parse(fs.readFileSync(file.output.slice(6), 'utf8')).found, true);
  fs.rmSync(file.output.slice(6));
  assert.equal(ctx.run(['--file','--pick','found','find-phase','01']).output, 'true');
  assert.deepEqual(fs.readdirSync(ctx.tmp).filter(name => /^gsd-.*\.json$/.test(name)), []);
  const quick = ctx.run(['init','quick','--verify','short','--verify','task']);
  assert.equal(quick.success, true, quick.error);
  assert.equal(JSON.parse(quick.output).description, 'short task');
}));
