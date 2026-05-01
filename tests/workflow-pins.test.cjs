'use strict';
// workflow-pins.test.cjs — asserts every `uses:` line in .github/workflows/*.yml
// references a 40-hex-char SHA pin or a local path (./.github/... / ./). No bare
// tag references (e.g. @v7) are allowed. This catches F-PIN class findings.
//
// Allowlist: local actions (./) and Docker images (docker://) are allowed without SHA pins.
// All external actions (owner/repo@ref) must be SHA-pinned.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const WORKFLOWS_DIR = path.resolve(__dirname, '..', '.github', 'workflows');
const SHA_PATTERN = /^[0-9a-f]{40}$/;

// A `uses:` value can be:
//   owner/repo@SHA40char                 — external action, SHA-pinned (ALLOWED)
//   owner/repo@ref                       — external action, tag/branch ref (DISALLOWED)
//   ./path/to/local/action               — local action (ALLOWED without SHA)
//   docker://image                       — Docker image (ALLOWED without SHA)
function parseUsesRef(usesValue) {
  const trimmed = usesValue.trim();
  // Local action or docker
  if (trimmed.startsWith('./') || trimmed.startsWith('docker://')) {
    return { type: 'local', pinned: true, ref: trimmed };
  }
  // External action: owner/repo@ref
  const atIdx = trimmed.lastIndexOf('@');
  if (atIdx === -1) {
    return { type: 'external', pinned: false, ref: trimmed };
  }
  const ref = trimmed.slice(atIdx + 1).trim();
  // Remove inline comment if present (e.g., "# v7.0.1")
  const refNoComment = ref.replace(/#.*$/, '').trim();
  const pinned = SHA_PATTERN.test(refNoComment);
  return { type: 'external', pinned, ref: refNoComment, full: trimmed };
}

describe('workflow-pins', () => {
  test('all uses: references in .github/workflows/*.yml are SHA-pinned', () => {
    const workflowFiles = fs
      .readdirSync(WORKFLOWS_DIR)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((f) => path.join(WORKFLOWS_DIR, f));

    assert.ok(
      workflowFiles.length > 0,
      'Must have at least one workflow file to check',
    );

    const violations = [];

    for (const wfFile of workflowFiles) {
      const content = fs.readFileSync(wfFile, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Match `uses: some/value` or `- uses: some/value`
        const match = line.match(/^\s*-?\s*uses:\s*(.+)$/);
        if (!match) continue;
        const usesRaw = match[1].trim();
        const parsed = parseUsesRef(usesRaw);
        if (!parsed.pinned) {
          violations.push({
            file: path.relative(path.resolve(__dirname, '..'), wfFile),
            line: i + 1,
            uses: usesRaw,
          });
        }
      }
    }

    assert.strictEqual(
      violations.length,
      0,
      'All uses: references must be SHA-pinned (40-hex-char SHA).\n' +
        'Violations found:\n' +
        violations
          .map(
            (v) =>
              `  ${v.file}:${v.line}: uses: ${v.uses}`,
          )
          .join('\n'),
    );
  });
});
