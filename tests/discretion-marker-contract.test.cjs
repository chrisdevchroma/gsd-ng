'use strict';

// Contract lock for the CONTEXT.md freedom-area marker heading.
//
// The plan-checker's decision scan stops at the discretion marker; every
// producer that writes the section must emit the exact string the stop
// sentinel watches for. A rename that lands on one side only makes the
// boundary check silently misfire - unguarded discretion bullets scan as
// locked decisions and raise false decision_coverage CRITICALs - and this
// class of breakage has happened twice. This test pins both sides to the
// same string and keeps the retired heading out of the shipped trees.

const fs = require('fs');
const path = require('path');
const { describe, test } = require('node:test');
const assert = require('node:assert');

const REPO_ROOT = path.join(__dirname, '..');

const MARKER = "Agent's Discretion";
const CANONICAL_HEADING = `### ${MARKER}`;
const RETIRED_HEADING = 'Discretion Areas';
const CHECKER = 'agents/gsd-plan-checker.md';
const SCAFFOLD = 'gsd-ng/bin/lib/commands.cjs';

// Every site that writes the freedom-area section into an artifact the
// checker later reads: templates, the discuss/plan/quick workflows, the
// scaffold command.
const PRODUCER_FILES = [
  'gsd-ng/templates/context.md',
  'gsd-ng/templates/research.md',
  'gsd-ng/workflows/discuss-phase.md',
  'gsd-ng/workflows/plan-phase.md',
  'gsd-ng/workflows/quick.md',
  SCAFFOLD,
];

// Trees that must no longer contain the retired heading.
const SCANNED_DIRS = ['gsd-ng', 'agents', 'commands', 'bin'];
const SCANNED_EXTENSIONS = new Set(['.md', '.cjs', '.js', '.json', '.txt']);

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

// Extract the fenced heading from each checker stop instruction
// ("Stop reading at `### Agent's Discretion`", "stop before `### ...`").
// The stop sentinel is the authority for the heading level the scan halts on.
function sentinelHeadings(source) {
  const headings = [];
  const re = /stop(?:\s+\w+)*\s+`(#{1,6}) Agent's Discretion`/gi;
  for (const match of source.matchAll(re)) {
    headings.push(`${match[1]} ${MARKER}`);
  }
  return headings;
}

function walkTextFiles(dir) {
  const files = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkTextFiles(full));
    } else if (SCANNED_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(full);
    }
  }
  return files;
}

describe('discretion marker contract', () => {
  test('every producer emits the canonical marker string', () => {
    for (const rel of PRODUCER_FILES) {
      assert.ok(
        read(rel).includes(MARKER),
        `${rel} must emit the "${MARKER}" marker`,
      );
    }
  });

  test('checker stop sentinels use the canonical marker string', () => {
    const headings = sentinelHeadings(read(CHECKER));
    // Guard the extraction itself: a silent zero-match would make the
    // identity assertions below vacuous.
    assert.ok(
      headings.length >= 3,
      'expected the checker to carry multiple stop sentinels; extraction broke',
    );
    for (const heading of headings) {
      assert.strictEqual(heading, CANONICAL_HEADING);
    }
  });

  test('scaffold emits the exact heading the stop sentinel halts on', () => {
    const headings = [...new Set(sentinelHeadings(read(CHECKER)))];
    const scaffold = read(SCAFFOLD);
    for (const heading of headings) {
      assert.ok(
        scaffold.includes(heading),
        `scaffold must emit "${heading}" to match the checker stop sentinel`,
      );
    }
  });

  test('retired heading is absent from the shipped source trees', () => {
    for (const rel of SCANNED_DIRS) {
      for (const file of walkTextFiles(path.join(REPO_ROOT, rel))) {
        assert.ok(
          !fs.readFileSync(file, 'utf-8').includes(RETIRED_HEADING),
          `${path.relative(REPO_ROOT, file)} must not reference the retired "${RETIRED_HEADING}" heading`,
        );
      }
    }
  });
});
