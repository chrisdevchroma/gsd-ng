#!/usr/bin/env node
'use strict';
const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const DIST = path.join(ROOT, 'dist');
fs.mkdirSync(DIST, { recursive: true });
const OUT = path.join(DIST, 'get-shit-done-ng.tar.gz');

// Guard: hooks/dist must be populated before packaging
const distDir = path.join(ROOT, 'hooks', 'dist');
if (!fs.existsSync(distDir) || fs.readdirSync(distDir).length === 0) {
  throw new Error('hooks/dist is empty — run npm run build:hooks first');
}

// Include all files declared in package.json
const include = [...pkg.files].join(' ');
execSync(`tar czf "${OUT}" ${include}`, { cwd: ROOT, stdio: 'inherit' });
console.log(`Created: ${OUT} (v${pkg.version})`);
