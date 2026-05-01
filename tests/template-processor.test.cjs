'use strict';

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { processTemplate, validateMarkers, buildContext, RUNTIMES, fillBetweenMarkers } = require('../gsd-ng/bin/lib/template-processor.cjs');
const { resolveTmpDir, cleanup } = require('./helpers.cjs');

const BASE_TMPDIR = resolveTmpDir();

// --- Variable substitution ---

describe('processTemplate - variable substitution', () => {
  const cases = [
    {
      name: 'resolves context variable',
      input: 'Hello {{NAME}}',
      context: { runtime: 'claude', NAME: 'World' },
      expected: 'Hello World',
    },
    {
      name: 'resolves PROJECT_RULES_FILE for claude',
      input: '{{PROJECT_RULES_FILE}}',
      context: { runtime: 'claude' },
      expected: 'CLAUDE.md',
    },
    {
      name: 'resolves PROJECT_RULES_FILE for copilot',
      input: '{{PROJECT_RULES_FILE}}',
      context: { runtime: 'copilot' },
      expected: '.github/copilot-instructions.md',
    },
    {
      name: 'resolves USER_QUESTION_TOOL for claude',
      input: '{{USER_QUESTION_TOOL}}',
      context: { runtime: 'claude' },
      expected: 'AskUserQuestion',
    },
    {
      name: 'leaves unknown variable as-is',
      input: '{{UNKNOWN_VAR}}',
      context: { runtime: 'claude' },
      expected: '{{UNKNOWN_VAR}}',
    },
    {
      name: 'replacement containing $1 does not trigger backreference',
      input: 'path is {{VAR}}',
      context: { runtime: 'claude', VAR: '$1/foo' },
      expected: 'path is $1/foo',
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      assert.equal(processTemplate(c.input, c.context), c.expected);
    });
  }
});

// --- Conditional blocks ---

describe('processTemplate - conditional blocks', () => {
  const cases = [
    {
      name: 'keeps matching claude block',
      input: '<!-- ONLY:claude -->Claude text<!-- /ONLY:claude -->',
      context: { runtime: 'claude' },
      expected: 'Claude text',
    },
    {
      name: 'strips non-matching claude block for copilot runtime',
      input: '<!-- ONLY:claude -->Claude text<!-- /ONLY:claude -->',
      context: { runtime: 'copilot' },
      expected: '',
    },
    {
      name: 'keeps matching copilot block',
      input: '<!-- ONLY:copilot -->Copilot text<!-- /ONLY:copilot -->',
      context: { runtime: 'copilot' },
      expected: 'Copilot text',
    },
    {
      name: 'mixed blocks - keeps correct one for claude',
      input: '<!-- ONLY:claude -->C<!-- /ONLY:claude -->|<!-- ONLY:copilot -->P<!-- /ONLY:copilot -->',
      context: { runtime: 'claude' },
      expected: 'C|',
    },
    {
      name: 'mixed blocks - keeps correct one for copilot',
      input: '<!-- ONLY:claude -->C<!-- /ONLY:claude -->|<!-- ONLY:copilot -->P<!-- /ONLY:copilot -->',
      context: { runtime: 'copilot' },
      expected: '|P',
    },
    {
      name: 'multiline content inside conditional block preserved',
      input: '<!-- ONLY:claude -->line1\nline2\nline3<!-- /ONLY:claude -->',
      context: { runtime: 'claude' },
      expected: 'line1\nline2\nline3',
    },
    {
      name: 'variable inside conditional block resolved after block resolution',
      input: '<!-- ONLY:claude -->File: {{PROJECT_RULES_FILE}}<!-- /ONLY:claude -->',
      context: { runtime: 'claude' },
      expected: 'File: CLAUDE.md',
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      assert.equal(processTemplate(c.input, c.context), c.expected);
    });
  }
});

// --- validateMarkers ---

describe('validateMarkers', () => {
  const cases = [
    {
      name: 'balanced markers do not throw',
      input: '<!-- ONLY:claude -->text<!-- /ONLY:claude -->',
      shouldThrow: false,
    },
    {
      name: 'unclosed open marker throws with Unbalanced',
      input: '<!-- ONLY:claude -->text',
      shouldThrow: true,
      messagePattern: /Unbalanced/,
    },
    {
      name: 'close without open throws',
      input: '<!-- /ONLY:claude -->',
      shouldThrow: true,
      messagePattern: /Unbalanced/,
    },
    {
      name: 'empty content does not throw',
      input: '',
      shouldThrow: false,
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      if (c.shouldThrow) {
        assert.throws(() => validateMarkers(c.input), c.messagePattern);
      } else {
        assert.doesNotThrow(() => validateMarkers(c.input));
      }
    });
  }
});

// --- buildContext ---

describe('buildContext', () => {
  const cases = [
    {
      name: 'returns runtime only when no options',
      runtime: 'claude',
      options: undefined,
      expected: { runtime: 'claude' },
    },
    {
      name: 'merges extra options',
      runtime: 'claude',
      options: { extra: true },
      expected: { runtime: 'claude', extra: true },
    },
  ];

  for (const c of cases) {
    test(c.name, () => {
      assert.deepEqual(buildContext(c.runtime, c.options), c.expected);
    });
  }
});

// --- RUNTIMES registry ---

describe('RUNTIMES', () => {
  test('claude PROJECT_RULES_FILE is CLAUDE.md', () => {
    assert.equal(RUNTIMES.claude.PROJECT_RULES_FILE, 'CLAUDE.md');
  });

  test('copilot PROJECT_RULES_FILE is .github/copilot-instructions.md', () => {
    assert.equal(RUNTIMES.copilot.PROJECT_RULES_FILE, '.github/copilot-instructions.md');
  });
});

// --- fillBetweenMarkers ---

describe('fillBetweenMarkers', () => {
  test('fills content between markers from template inner content', () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'tp-fill-'));
    try {
      const targetPath = path.join(tmpDir, 'target.md');
      const templatePath = path.join(tmpDir, 'template.md');
      fs.writeFileSync(targetPath, 'before\n<!-- START -->\n<!-- /START -->\nafter\n');
      fs.writeFileSync(templatePath, '<!-- START -->\ninner content\n<!-- /START -->\n');
      fillBetweenMarkers(targetPath, templatePath, '<!-- START -->', '<!-- /START -->');
      const result = fs.readFileSync(targetPath, 'utf8');
      assert.ok(result.includes('inner content'), 'filled content must appear between markers');
      assert.ok(result.includes('before'), 'content before markers must be preserved');
      assert.ok(result.includes('after'), 'content after markers must be preserved');
    } finally {
      cleanup(tmpDir);
    }
  });

  test('overwrites existing content between markers (always in sync with template)', () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'tp-fill-'));
    try {
      const targetPath = path.join(tmpDir, 'target.md');
      const templatePath = path.join(tmpDir, 'template.md');
      fs.writeFileSync(targetPath, '<!-- START -->\nstale content\n<!-- /START -->\n');
      fs.writeFileSync(templatePath, '<!-- START -->\nfresh content\n<!-- /START -->\n');
      fillBetweenMarkers(targetPath, templatePath, '<!-- START -->', '<!-- /START -->');
      const result = fs.readFileSync(targetPath, 'utf8');
      assert.ok(result.includes('fresh content'), 'stale content must be replaced with template content');
      assert.ok(!result.includes('stale content'), 'stale content must not remain');
    } finally {
      cleanup(tmpDir);
    }
  });

  test('no-op if target file does not exist', () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'tp-fill-'));
    try {
      const templatePath = path.join(tmpDir, 'template.md');
      fs.writeFileSync(templatePath, '<!-- S -->\ncontent\n<!-- /S -->\n');
      assert.doesNotThrow(() => {
        fillBetweenMarkers(path.join(tmpDir, 'missing.md'), templatePath, '<!-- S -->', '<!-- /S -->');
      });
    } finally {
      cleanup(tmpDir);
    }
  });

  test('no-op if markers are absent from target file', () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'tp-fill-'));
    try {
      const targetPath = path.join(tmpDir, 'target.md');
      const templatePath = path.join(tmpDir, 'template.md');
      const original = 'no markers here\n';
      fs.writeFileSync(targetPath, original);
      fs.writeFileSync(templatePath, '<!-- S -->\ncontent\n<!-- /S -->\n');
      fillBetweenMarkers(targetPath, templatePath, '<!-- S -->', '<!-- /S -->');
      assert.equal(fs.readFileSync(targetPath, 'utf8'), original, 'file must be unchanged when markers absent');
    } finally {
      cleanup(tmpDir);
    }
  });

  test('falls back to full template when template has no markers', () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'tp-fill-'));
    try {
      const targetPath = path.join(tmpDir, 'target.md');
      const templatePath = path.join(tmpDir, 'template.md');
      fs.writeFileSync(targetPath, '<!-- S -->\n<!-- /S -->\n');
      fs.writeFileSync(templatePath, 'bare template content\n');
      fillBetweenMarkers(targetPath, templatePath, '<!-- S -->', '<!-- /S -->');
      const result = fs.readFileSync(targetPath, 'utf8');
      assert.ok(result.includes('bare template content'), 'bare template content must be injected as fallback');
    } finally {
      cleanup(tmpDir);
    }
  });
});

// --- Idempotency ---

describe('processTemplate - idempotency', () => {
  test('applying processTemplate twice yields same result as once', () => {
    const input = '<!-- ONLY:claude -->{{PROJECT_RULES_FILE}}<!-- /ONLY:claude -->|<!-- ONLY:copilot -->{{PROJECT_RULES_FILE}}<!-- /ONLY:copilot -->';
    const ctx = { runtime: 'claude' };
    const once = processTemplate(input, ctx);
    const twice = processTemplate(once, ctx);
    assert.equal(twice, once);
  });
});

// --- Input validation ---

describe('processTemplate - input validation (F-005)', () => {
  test('F-005: processTemplate throws descriptive error when context is null', () => {
    assert.throws(
      () => processTemplate('hello {{NAME}}', null),
      (err) => {
        assert.ok(err instanceof Error, 'should throw an Error');
        assert.ok(
          err.message.includes('context') && err.message.includes('non-null'),
          `Expected descriptive error about context being non-null, got: ${err.message}`,
        );
        return true;
      },
    );
  });

  test('F-005: processTemplate throws descriptive error when context is undefined', () => {
    assert.throws(
      () => processTemplate('hello {{NAME}}', undefined),
      (err) => {
        assert.ok(err instanceof Error, 'should throw an Error');
        assert.ok(
          err.message.includes('context'),
          `Expected error mentioning context, got: ${err.message}`,
        );
        return true;
      },
    );
  });
});
