'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const EXPECTED = [
  ['UI, frontend, components', 'CONVENTIONS.md, STRUCTURE.md'],
  ['API, backend, endpoints', 'ARCHITECTURE.md, CONVENTIONS.md'],
  ['database, schema, models', 'ARCHITECTURE.md, STACK.md'],
  ['testing, tests', 'TESTING.md, CONVENTIONS.md'],
  ['integration, external API', 'INTEGRATIONS.md, STACK.md'],
  ['refactor, cleanup', 'CONCERNS.md, ARCHITECTURE.md'],
  ['setup, config', 'STACK.md, STRUCTURE.md'],
  ['(default)', 'STACK.md, ARCHITECTURE.md'],
];

function cells(line, source) {
  assert.match(line, /^\s*\|.*\|\s*$/, `${source}: malformed table row: ${line}`);
  const parts = line.trim().slice(1, -1).split('|').map((cell) => cell.trim().replace(/^`|`$/g, ''));
  assert.equal(parts.length, 2, `${source}: expected two cells: ${line}`);
  assert.ok(parts.every(Boolean), `${source}: empty table cell: ${line}`);
  return parts;
}

function extractTable(text, source, firstHeader, secondHeader) {
  const lines = text.split(/\r?\n/);
  const headerIndices = lines.flatMap((line, index) =>
    /^\s*\|/.test(line) && line.trim().slice(1).split('|')[0].trim() === firstHeader
      ? [index]
      : [],
  );
  assert.equal(headerIndices.length, 1, `${source}: expected exactly one ${firstHeader} table header`);
  const index = headerIndices[0];
  assert.deepEqual(cells(lines[index], source), [firstHeader, secondHeader], `${source}: wrong header`);
  assert.ok(index + 1 < lines.length, `${source}: missing separator`);
  const separator = cells(lines[index + 1], source);
  assert.ok(separator.every((cell) => /^:?-{3,}:?$/.test(cell)), `${source}: invalid separator`);

  const rows = [];
  for (let row = index + 2; row < lines.length && /^\s*\|/.test(lines[row]); row++) {
    rows.push(cells(lines[row], source));
  }
  return rows;
}

function assertRouting(planner, mapper) {
  const plannerRows = extractTable(planner, 'planner', 'Phase Keywords', 'Load These');
  const mapperRows = extractTable(mapper, 'mapper', 'Phase Type', 'Documents Loaded');
  for (const [source, rows] of [['planner', plannerRows], ['mapper', mapperRows]]) {
    assert.equal(rows.length, 8, `${source}: expected eight routing rows`);
    assert.equal(new Set(rows.map(([route]) => route)).size, 8, `${source}: duplicate route`);
    assert.equal(rows.filter(([route]) => route === '(default)').length, 1, `${source}: expected one default`);
    assert.deepEqual(rows, EXPECTED, `${source}: routing differs from canonical mapping`);
  }
  assert.deepEqual(plannerRows, mapperRows, 'planner and mapper routing differs');
}

function table(first, second, rows = EXPECTED) {
  return [
    `| ${first} | ${second} |`,
    '|---|---|',
    ...rows.map(([route, docs]) => `| ${route} | ${docs} |`),
    'not a table row',
  ].join('\n');
}

test('routing contract rejects changes in either or both tables', () => {
  const planner = table('Phase Keywords', 'Load These');
  const mapper = table('Phase Type', 'Documents Loaded');
  assert.doesNotThrow(() => assertRouting(planner, mapper));

  const changes = [
    [planner, table('Phase Type', 'Documents Loaded', EXPECTED.slice(0, -1))],
    [table('Phase Keywords', 'Load These', [...EXPECTED, ['new route', 'STACK.md']]), mapper],
    [planner.replace('UI, frontend, components', 'UI, frontend, widgets'), mapper],
    [planner, mapper.replace('TESTING.md, CONVENTIONS.md', 'STACK.md, CONVENTIONS.md')],
    [planner, mapper.replace('setup, config', '(default)')],
    [planner, mapper.replace('| (default) | STACK.md, ARCHITECTURE.md |', '')],
    [planner.replace('TESTING.md, CONVENTIONS.md', 'STACK.md, CONVENTIONS.md'),
      mapper.replace('TESTING.md, CONVENTIONS.md', 'STACK.md, CONVENTIONS.md')],
    [planner, mapper.replace('| (default) |', '| (default) | EXTRA |')],
    [planner, mapper.replace('| Phase Type | Documents Loaded |', '| Phase Type | Documents Loaded |\n| Phase Type | Documents Loaded |')],
    [planner, mapper.replace('|---|---|', '|--|---|')],
  ];
  for (const [changedPlanner, changedMapper] of changes) {
    assert.throws(() => assertRouting(changedPlanner, changedMapper));
  }
});

test('tracked planner and mapper each match the exact routing contract', () => {
  const agents = path.join(__dirname, '..', 'agents');
  assertRouting(
    fs.readFileSync(path.join(agents, 'gsd-planner.md'), 'utf8'),
    fs.readFileSync(path.join(agents, 'gsd-codebase-mapper.md'), 'utf8'),
  );
});
