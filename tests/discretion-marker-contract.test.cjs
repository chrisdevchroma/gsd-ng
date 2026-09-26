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
const SCAFFOLD = 'gsd-ng/bin/lib/commands.cjs';

// Every site that writes the freedom-area section into an artifact the
// checker later reads: templates, the discuss/plan/quick workflows, the
// scaffold command.
const PRODUCER_HEADING_COUNTS = new Map([
  ['gsd-ng/templates/context.md', 4],
  ['gsd-ng/templates/research.md', 1],
  ['gsd-ng/workflows/discuss-phase.md', 1],
  ['gsd-ng/workflows/plan-phase.md', 1],
  ['gsd-ng/workflows/quick.md', 1],
  [SCAFFOLD, 1],
]);

// Every agent that interprets or reproduces the marker heading. Counts keep a
// deleted reference from making the level assertion pass vacuously.
const CONSUMER_HEADING_COUNTS = new Map([
  ['agents/gsd-planner.md', 1],
  ['agents/gsd-plan-checker.md', 4],
  ['agents/gsd-phase-researcher.md', 3],
  ['agents/gsd-ui-researcher.md', 1],
]);

// Trees that must no longer contain the retired heading.
const SCANNED_DIRS = ['gsd-ng', 'agents', 'commands', 'bin'];
const SCANNED_EXTENSIONS = new Set(['.md', '.cjs', '.js', '.json', '.txt']);

function read(relPath) {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf-8');
}

function producerText(relPath) {
  return read(relPath).replaceAll('\\n', '\n');
}

// Match only heading-shaped marker references. Ordinary prose such as
// "capture as Agent's Discretion" intentionally does not enter the contract.
function markerHeadings(source) {
  return [...source.matchAll(/(#{1,6}) Agent's Discretion/g)].map(
    (match) => `${match[1]} ${MARKER}`,
  );
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
  test('every producer heading site emits the canonical h3 marker', () => {
    for (const [rel, expectedCount] of PRODUCER_HEADING_COUNTS) {
      const headings = markerHeadings(producerText(rel));
      assert.strictEqual(
        headings.length,
        expectedCount,
        `${rel} must contain ${expectedCount} marker heading site(s)`,
      );
      assert.deepStrictEqual(
        headings,
        Array(expectedCount).fill(CANONICAL_HEADING),
        `${rel} marker heading sites must all be "${CANONICAL_HEADING}"`,
      );
    }
  });

  test('every consumer heading reference uses the canonical h3 marker', () => {
    for (const [rel, expectedCount] of CONSUMER_HEADING_COUNTS) {
      const headings = markerHeadings(read(rel));
      assert.strictEqual(
        headings.length,
        expectedCount,
        `${rel} must contain ${expectedCount} marker heading reference(s)`,
      );
      assert.deepStrictEqual(
        headings,
        Array(expectedCount).fill(CANONICAL_HEADING),
        `${rel} marker heading references must all be "${CANONICAL_HEADING}"`,
      );
    }
  });

  test('checker stop sentinels use the canonical marker string', () => {
    const checker = 'agents/gsd-plan-checker.md';
    const headings = sentinelHeadings(read(checker));
    assert.strictEqual(headings.length, 3, 'checker must carry three stop sentinels');
    assert.deepStrictEqual(headings, Array(3).fill(CANONICAL_HEADING));
  });

  test('scaffold emits the exact heading the stop sentinel halts on', () => {
    const headings = [CANONICAL_HEADING];
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
