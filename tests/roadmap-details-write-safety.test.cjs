const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createTempProject, cleanup, runGsdTools } = require('./helpers.cjs');

const commands = [
  ['remove', ['phase', 'remove', '2', '--force', '--json'], /Phase 2: Older/],
  ['complete', ['phase', 'complete', '2', '--json'], /Phase 2: Older/],
  ['add', ['phase', 'add', 'New Phase', '--json'], /Phase 2: Older/],
  ['insert', ['phase', 'insert', '2', 'Urgent Fix', '--json'], /Phase 2: Older/],
  ['progress', ['roadmap', 'update-plan-progress', '2', '--json'], /Phase 2: Older/],
];

function snapshot(dir) {
  const result = {};
  function visit(parent, relative) {
    for (const entry of fs.readdirSync(parent, { withFileTypes: true })) {
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) {
        result[`${name}/`] = null;
        visit(path.join(parent, entry.name), name);
      } else {
        result[name] = fs.readFileSync(path.join(parent, entry.name)).toString('hex');
      }
    }
  }
  visit(path.join(dir, '.planning'), '');
  return result;
}

function fixture(archive, { plans = true, roadmap = true, suffix = '' } = {}) {
  const dir = createTempProject();
  const planning = path.join(dir, '.planning');
  const content = [
    '# Roadmap', '', archive, '', '## Current', '',
    '- [ ] Phase 2: Live', '- [ ] Phase 3: Later', '',
    '| Phase | Plans | Status | Completed |',
    '|-------|-------|--------|-----------|',
    '| 2. Live | 0/1 | Planned | - |', '',
    '### Phase 2: Live', '**Goal:** live', '**Plans:** 1 plan', '',
    '### Phase 3: Later', '**Goal:** later', '', suffix,
  ].join('\n');
  if (roadmap) fs.writeFileSync(path.join(planning, 'ROADMAP.md'), content);
  fs.writeFileSync(path.join(planning, 'STATE.md'), '# State\n\n**Current Phase:** 2\n**Total Phases:** 3\n');
  fs.writeFileSync(path.join(planning, 'REQUIREMENTS.md'), '# Requirements\n\n- [ ] **SAFE-01** Live\n');
  for (const [name, label] of [['02-live', 'live'], ['03-later', 'later']]) {
    const phaseDir = path.join(planning, 'phases', name);
    fs.mkdirSync(phaseDir);
    fs.writeFileSync(path.join(phaseDir, 'sentinel.txt'), label);
  }
  if (plans) {
    const phaseDir = path.join(planning, 'phases', '02-live');
    fs.writeFileSync(path.join(phaseDir, '02-01-PLAN.md'), '---\nphase: 02-live\nplan: 01\nrequirements: [SAFE-01]\n---\n# Plan\n');
    fs.writeFileSync(path.join(phaseDir, '02-01-SUMMARY.md'), '---\nphase: 02-live\nplan: 01\n---\n# Summary\n');
  }
  return { dir, content };
}

const archived = (open = '<details>', close = '</details>') =>
  `${open}\n<summary>Legacy</summary>\n- [x] Phase 2: Older\n### Phase 2: Older\n**Goal:** archived\n${close}`;

function checkMalformed(archive, label, suffix = '') {
  for (const [name, args] of commands) {
    test(`${label}: ${name} refuses without changing planning bytes or names`, () => {
      const { dir } = fixture(archive, { suffix });
      try {
        const before = snapshot(dir);
        const result = runGsdTools(args, dir);
        assert.equal(result.success, false, `${name} unexpectedly succeeded: ${JSON.stringify(result)}; archived heading after: ${fs.readFileSync(path.join(dir, '.planning', 'ROADMAP.md'), 'utf8').includes('### Phase 2: Older')}; phase dirs after: ${fs.readdirSync(path.join(dir, '.planning', 'phases')).join(', ')}`);
        assert.match(result.error, /ROADMAP\.md.*details/i);
        assert.deepEqual(snapshot(dir), before);
      } finally {
        cleanup(dir);
      }
    });
  }
}

checkMalformed(archived('<details>', ''), 'unclosed opener (forced removal reaches deletion)');
checkMalformed(archived('<DETAILS>', ''), 'uppercase unclosed opener');
checkMalformed(archived('<details open>', ''), 'attributed unclosed opener');
checkMalformed(`${archived()}\n</DETAILS  >`, 'stray closer after archive');
checkMalformed(archived(), 'stray closer after live material', '\n</details>');
checkMalformed(`${archived('<details>', '')}\n<details>\n</details>`, 'invalid nesting');

test('malformed roadmap rejects progress even with zero plans', () => {
  const { dir } = fixture(archived('<details>', ''), { plans: false });
  try {
    const before = snapshot(dir);
    const result = runGsdTools(commands[4][1], dir);
    assert.equal(result.success, false, JSON.stringify(result));
    assert.match(result.error, /ROADMAP\.md.*details/i);
    assert.deepEqual(snapshot(dir), before);
  } finally { cleanup(dir); }
});

for (const [name, args] of commands) {
  test(`absent ROADMAP keeps ${name} command-specific behavior`, () => {
    const { dir } = fixture('', { roadmap: false });
    try {
      const before = snapshot(dir);
      const result = runGsdTools(args, dir);
      if (name === 'complete') {
        assert.equal(result.success, true, JSON.stringify(result));
      } else if (name === 'progress') {
        assert.equal(result.success, true, JSON.stringify(result));
        assert.match(result.output, /ROADMAP\.md not found/);
      } else {
        assert.equal(result.success, false, JSON.stringify(result));
        assert.match(result.error, /ROADMAP\.md not found/);
        assert.deepEqual(snapshot(dir), before);
      }
    } finally { cleanup(dir); }
  });
}

const valid = [
  ['balanced', archived()],
  ['two archives', `${archived()}\n${archived('<DETAILS open>', '</DETAILS >')}`],
  ['nested', archived('<details>', '\n<details>\ninner\n</details>\nouter tail\n</details>')],
  ['mixed spelling', archived('<DETAILS\n open>', '</DETAILS  >')],
  ['fences around archives', `\`\`\`markdown\n<details>\n\`\`\`\n${archived()}\n~~~html\n</details>\n~~~`],
  ['fence-only', '\`\`\`markdown\n<details>\n</details>\n\`\`\`'],
  ['unclosed fenced opener', '~~~html\n<details>\n~~~'],
  ['fenced closer after archive', `${archived()}\n\`\`\`html\n</details>\n\`\`\``],
];

for (const [shape, archive] of valid) {
  for (const [name, args] of commands) {
    test(`${shape}: ${name} writes live content without changing archive`, () => {
      const { dir, content } = fixture(archive);
      try {
        const result = runGsdTools(args, dir);
        assert.equal(result.success, true, JSON.stringify(result));
        const after = fs.readFileSync(path.join(dir, '.planning', 'ROADMAP.md'), 'utf8');
        assert.ok(after.includes(archive), 'archive/example bytes changed');
        assert.notEqual(after, content, `${name} made no roadmap write`);
        if (name === 'remove') assert.ok(!after.includes('### Phase 2: Live'));
        if (name === 'add') assert.match(after, /### Phase 4: New Phase/);
        if (name === 'insert') assert.match(after, /### Phase 02\.1: Urgent Fix/);
        if (name === 'complete') assert.match(after, /\[x\] Phase 2: Live/);
        if (name === 'progress') assert.match(after, /1\/1/);
      } finally { cleanup(dir); }
    });
  }
}
