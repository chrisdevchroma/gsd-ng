'use strict';
// Phase 50 — Security Benchmark Coverage Tests
//
// Loads vendored fixtures from tests/fixtures/security-coverage/ and asserts
// that scanForInjection behaves correctly on representative attack and benign
// samples. Pure pass/fail; no snapshots, no thresholds, no percentages.
//
// Plans:
//   50-01: Scaffold + shared loader + fixture sanity (this file's initial form)
//   50-02: Homoglyph normalization + evasion-surface assertions
//   50-03: Multi-language pattern assertions
//   50-04: New English families + Lakera/deepset/Garak coverage assertions
//
// Failure messages always include {id, source_dataset, attack_family} so a red
// CI run is self-diagnosing.

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const FIXTURE_DIR = path.join(__dirname, 'fixtures', 'security-coverage');
const REQUIRED_FIXTURES = [
  'lakera-gandalf-sample.jsonl',
  'deepset-injection-sample.jsonl',
  'garak-promptinject-sample.jsonl',
  'multilang-patterns.jsonl',
];
const REQUIRED_DOCS = ['LICENSE', 'README.md'];

function loadFixtures(filename) {
  const fp = path.join(FIXTURE_DIR, filename);
  const raw = fs.readFileSync(fp, 'utf8').trim();
  if (!raw) return [];
  return raw.split('\n').map((line, i) => {
    try {
      return JSON.parse(line);
    } catch (e) {
      throw new Error(`${filename} line ${i + 1}: ${e.message}`);
    }
  });
}

function describeFixture(fx) {
  return `${fx.id} (${fx.source_dataset}, family=${fx.attack_family})`;
}

// ─── Fixture sanity (50-01) ───────────────────────────────────────────────────
describe('Phase 50 fixture infrastructure', () => {
  test('all required fixture files exist', () => {
    for (const f of REQUIRED_FIXTURES) {
      assert.ok(
        fs.existsSync(path.join(FIXTURE_DIR, f)),
        `missing fixture: ${f}`,
      );
    }
  });

  test('LICENSE and README present', () => {
    for (const f of REQUIRED_DOCS) {
      assert.ok(
        fs.existsSync(path.join(FIXTURE_DIR, f)),
        `missing doc: ${f}`,
      );
    }
  });

  test('every fixture entry has the required schema fields', () => {
    const required = ['id', 'source_dataset', 'text', 'expected_label', 'attack_family'];
    for (const f of REQUIRED_FIXTURES) {
      const entries = loadFixtures(f);
      for (const e of entries) {
        for (const k of required) {
          assert.ok(k in e, `${f}: ${describeFixture(e)} missing field "${k}"`);
        }
        assert.ok(typeof e.id === 'string' && e.id.length > 0, `${f}: empty id`);
        assert.ok(typeof e.text === 'string' && e.text.length > 0, `${f}: empty text on ${e.id}`);
        assert.ok(e.expected_label === 0 || e.expected_label === 1, `${f}: bad expected_label on ${e.id}`);
      }
    }
  });

  test('multilang-patterns.jsonl covers all 10 locked languages', () => {
    const entries = loadFixtures('multilang-patterns.jsonl');
    const requiredLangs = ['de', 'fr', 'es', 'zh', 'ja', 'ko', 'ru', 'pt', 'ar', 'hi'];
    for (const lang of requiredLangs) {
      const langEntries = entries.filter(e => e.id.startsWith(`multilang-${lang}-`));
      assert.ok(
        langEntries.some(e => e.expected_label === 1),
        `multilang fixture missing attack entry for language: ${lang}`,
      );
      assert.ok(
        langEntries.some(e => e.expected_label === 0),
        `multilang fixture missing benign entry for language: ${lang}`,
      );
    }
  });
});

// ─── Stubs for downstream plans ───────────────────────────────────────────────
// Plan 50-02 will populate: Homoglyph normalization tests
// Plan 50-03 will populate: Multi-language pattern detection + FP guard tests
// Plan 50-04 will populate: Context-reset / authority / roleplay tests + dataset coverage tests
//
// Export the loader for plans 02-04 to import (kept here as the canonical helper).
module.exports = { loadFixtures, FIXTURE_DIR, describeFixture };
