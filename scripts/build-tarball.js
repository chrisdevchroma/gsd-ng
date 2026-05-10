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

// Guard: hooks/dist must be populated before packaging
const distDir = path.join(ROOT, 'hooks', 'dist');
if (!fs.existsSync(distDir) || fs.readdirSync(distDir).length === 0) {
  throw new Error('hooks/dist is empty — run npm run build:hooks first');
}

// Include all files declared in package.json.
// Use execFileSync with an argument array (not shell interpolation) to avoid
// shell-injection risk if package.json files entries ever contain special chars.
execFileSync('tar', ['czf', OUT, ...pkg.files], { cwd: ROOT, stdio: 'inherit' });
console.log(`Created: ${OUT} (v${pkg.version})`);
