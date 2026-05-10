'use strict';
const { parseConfig, formatWidget } = require('./utils');

const config = parseConfig(process.argv[2] || '{}');
console.log('Widget Factory v1.0');
console.log('Widgets loaded:', config.widgets ? config.widgets.length : 0);
