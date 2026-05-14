#!/usr/bin/env node
'use strict';
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });
const OUT = path.join(DIST, 'gsd-ng.tar.gz');

// Include all files declared in package.json.
// Use execFileSync with an argument array (not shell interpolation) to avoid
// shell-injection risk if package.json files entries ever contain special chars.
execFileSync('tar', ['czf', OUT, ...pkg.files], { cwd: ROOT, stdio: 'inherit' });
console.log(`Created: ${OUT} (v${pkg.version})`);
