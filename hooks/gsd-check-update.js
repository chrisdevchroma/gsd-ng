#!/usr/bin/env node
// Check for GSD updates in background, write result to cache
// Called by SessionStart hook - runs once per session

const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');

const homeDir = os.homedir();
const cwd = process.cwd();

// Detect GSD config directory — supports Claude Code (.claude), Copilot local (.github), Copilot global (.copilot)
// Respects CLAUDE_CONFIG_DIR for custom config directory setups
function detectConfigDir(baseDir) {
  // Check env override first (supports multi-account setups)
  const envDir = process.env.CLAUDE_CONFIG_DIR;
  if (envDir && fs.existsSync(path.join(envDir, 'gsd-ng', 'VERSION'))) {
    return envDir;
  }
  // Check Claude Code local (.claude/gsd-ng/VERSION)
  if (fs.existsSync(path.join(baseDir, '.claude', 'gsd-ng', 'VERSION'))) {
    return path.join(baseDir, '.claude');
  }
  // Check Copilot local (.github/gsd-ng/VERSION)
  if (fs.existsSync(path.join(baseDir, '.github', 'gsd-ng', 'VERSION'))) {
    return path.join(baseDir, '.github');
  }
  // Check Copilot global (~/.copilot/gsd-ng/VERSION)
  if (fs.existsSync(path.join(baseDir, '.copilot', 'gsd-ng', 'VERSION'))) {
    return path.join(baseDir, '.copilot');
  }
  return envDir || path.join(baseDir, '.claude');
}

const globalConfigDir = detectConfigDir(homeDir);
const projectConfigDir = detectConfigDir(cwd);
const cacheDir = path.join(globalConfigDir, 'cache');
const cacheFile = path.join(cacheDir, 'gsd-update-check.json');

// VERSION file locations (check project first, then global)
const projectVersionFile = path.join(projectConfigDir, 'gsd-ng', 'VERSION');
const globalVersionFile = path.join(globalConfigDir, 'gsd-ng', 'VERSION');

// ── SemVer utilities (exported for testing via GSD_TEST_MODE) ──────────────
function compareSemVer(a, b) {
  const cleanA = a.split('+')[0].trim();
  const cleanB = b.split('+')[0].trim();
  const [aMaj, aMin, aPat] = cleanA.split('.').map(Number);
  const [bMaj, bMin, bPat] = cleanB.split('.').map(Number);
  if (aMaj !== bMaj) return aMaj - bMaj;
  if (aMin !== bMin) return aMin - bMin;
  return aPat - bPat;
}
function normalizeTag(tag) {
  return tag.startsWith('v') ? tag.slice(1) : tag;
}
function isSnapshot(version) {
  return version.includes('+');
}

// Test mode: export utilities and skip hook execution
if (process.env.GSD_TEST_MODE) {
  module.exports = { compareSemVer, normalizeTag, isSnapshot };
  return;
}

// GSD_OFFLINE: skip update check entirely — useful for CI and airgapped environments
if (process.env.GSD_OFFLINE) {
  process.exit(0);
}

// Ensure cache directory exists
// GSD_SIMULATE_SANDBOX: skip write — cacheDir is in ~/.claude which is EROFS in sandbox
if (!process.env.GSD_SIMULATE_SANDBOX) {
  try {
    if (!fs.existsSync(cacheDir)) {
      fs.mkdirSync(cacheDir, { recursive: true });
    }
  } catch (e) {
    // EROFS/EACCES/EPERM in sandbox — cache dir unavailable, skip update check
    process.exit(0);
  }
}

// Run check in background (spawn background process, windowsHide prevents console flash)
const child = spawn(process.execPath, ['-e', `
  const fs = require('fs');
  const { execSync } = require('child_process');

  const cacheFile = ${JSON.stringify(cacheFile)};
  const projectVersionFile = ${JSON.stringify(projectVersionFile)};
  const globalVersionFile = ${JSON.stringify(globalVersionFile)};
  const GITHUB_OWNER = ${JSON.stringify('chrisdevchroma')};
  const GITHUB_REPO = ${JSON.stringify('gsd-ng')};
  const GITHUB_TTL = 3600; // 1-hour cooldown between GitHub API checks
  const ASSET_NAME = 'gsd-ng.tar.gz';

  // SemVer utilities (duplicated inside spawn — separate process can't access outer scope)
  function compareSemVer(a, b) {
    const cleanA = a.split('+')[0].trim();
    const cleanB = b.split('+')[0].trim();
    const [aMaj, aMin, aPat] = cleanA.split('.').map(Number);
    const [bMaj, bMin, bPat] = cleanB.split('.').map(Number);
    if (aMaj !== bMaj) return aMaj - bMaj;
    if (aMin !== bMin) return aMin - bMin;
    return aPat - bPat;
  }
  function normalizeTag(tag) {
    return tag.startsWith('v') ? tag.slice(1) : tag;
  }
  function isSnapshot(version) {
    return version.includes('+');
  }

  // Check project directory first (local install), then global
  let installed = '0.0.0';
  try {
    if (fs.existsSync(projectVersionFile)) {
      installed = fs.readFileSync(projectVersionFile, 'utf8').trim();
    } else if (fs.existsSync(globalVersionFile)) {
      installed = fs.readFileSync(globalVersionFile, 'utf8').trim();
    }
  } catch (e) {}

  let latest = null;
  try {
    latest = execSync('npm view gsd-ng version', { encoding: 'utf8', timeout: 10000, windowsHide: true }).trim();
  } catch (e) {}

  let source = latest ? 'npm' : 'unknown';

  // If npm failed and installed version is not a snapshot, try GitHub
  if (!latest && !isSnapshot(installed)) {
    // Check TTL cooldown — skip GitHub if checked recently
    let cachedData = null;
    try { cachedData = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch(e) {}
    const now = Math.floor(Date.now() / 1000);
    if (cachedData && cachedData.source === 'github' && cachedData.checked && (now - cachedData.checked) < GITHUB_TTL) {
      // Within cooldown — reuse cached result, don't hit API
      process.exit(0);
    }

    // Query GitHub Releases API
    const https = require('https');
    const opts = {
      hostname: 'api.github.com',
      path: '/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/releases/latest',
      headers: {
        'User-Agent': 'gsd-ng',
        'Accept': 'application/vnd.github.v3+json',
      },
      timeout: 10000,
    };
    const cachedEtag = (cachedData && cachedData.etag) || null;
    if (cachedEtag) opts.headers['If-None-Match'] = cachedEtag;

    const req = https.request(opts, function(res) {
      const etag = res.headers['etag'] || null;

      // 304: release unchanged — update checked timestamp and exit
      if (res.statusCode === 304) {
        res.destroy();
        if (cachedData) {
          cachedData.checked = now;
          if (etag) cachedData.etag = etag;
          try { fs.writeFileSync(cacheFile, JSON.stringify(cachedData)); } catch(e) {}
        }
        process.exit(0);
      }

      // 404: no release exists yet — not an error, just no update
      if (res.statusCode === 404) {
        res.destroy();
        const result = { update_available: false, installed, latest: 'unknown', checked: now, source: 'github', etag: null };
        try { fs.writeFileSync(cacheFile, JSON.stringify(result)); } catch(e) {}
        process.exit(0);
      }

      // Non-200: unexpected — treat as failure, write no-update
      if (res.statusCode !== 200) {
        res.destroy();
        process.exit(0);
      }

      let data = '';
      res.on('data', function(c) { data += c; });
      res.on('end', function() {
        try {
          const r = JSON.parse(data);
          // Skip pre-release versions
          if (r.prerelease) { process.exit(0); }
          const tagVersion = normalizeTag(r.tag_name || '');
          if (!tagVersion) { process.exit(0); }
          latest = tagVersion;
          source = 'github';
          // Write cache with GitHub-specific fields
          const result = {
            update_available: compareSemVer(installed, latest) < 0,
            installed,
            latest,
            checked: now,
            source,
            etag: etag || null,
          };
          try { fs.writeFileSync(cacheFile, JSON.stringify(result)); } catch(e) {}
        } catch(e) {}
        process.exit(0);
      });
    });

    req.on('error', function() { process.exit(0); });
    req.on('timeout', function() { req.destroy(); process.exit(0); });
    req.end();
    // IMPORTANT: return here to prevent the synchronous write below from executing
    // The GitHub path is async — it writes cache in its own callbacks above
    return;
  }

  // Synchronous path (npm succeeded or both failed / snapshot version)
  const result = {
    update_available: !!(latest && compareSemVer(installed, latest) < 0),
    installed,
    latest: latest || 'unknown',
    checked: Math.floor(Date.now() / 1000),
    source,
  };

  fs.writeFileSync(cacheFile, JSON.stringify(result));
`], {
  stdio: 'ignore',
  windowsHide: true,
  detached: true  // Required on Windows for proper process detachment
});

child.unref();
