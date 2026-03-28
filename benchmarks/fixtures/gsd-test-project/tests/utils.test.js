'use strict';
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { parseConfig, formatWidget } = require('../src/utils');

describe('parseConfig', () => {
  it('parses valid JSON', () => {
    const result = parseConfig('{"widgets": [{"name": "foo", "type": "bar"}]}');
    assert.strictEqual(result.widgets.length, 1);
    assert.strictEqual(result.widgets[0].name, 'foo');
  });

  it('handles empty string without crashing', () => {
    // This test FAILS — the known bug
    const result = parseConfig('');
    assert.deepStrictEqual(result, { widgets: [] });
  });
});

describe('formatWidget', () => {
  it('formats widget correctly', () => {
    assert.strictEqual(formatWidget({ name: 'Gadget', type: 'A' }), '[A] Gadget');
  });
});
