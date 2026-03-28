#!/usr/bin/env node
'use strict';

/**
 * CI Security Scan — Scans PR diff for injection patterns
 *
 * Reuses security.cjs patterns. No duplicate pattern definitions.
 * Reads PR_NUMBER and GITHUB_TOKEN from environment.
 * Outputs GitHub Actions annotations (::error, ::warning).
 *
 * Exit code:
 *   0 — clean or warnings only
 *   1 — high-confidence detections found (blocking)
 */

const { scanForInjection } = require('../gsd-ng/bin/lib/security.cjs');

const PR_NUMBER = process.env.PR_NUMBER;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const GITHUB_REPOSITORY = process.env.GITHUB_REPOSITORY;

if (!PR_NUMBER || !GITHUB_TOKEN || !GITHUB_REPOSITORY) {
  console.error('Missing required env vars: PR_NUMBER, GITHUB_TOKEN, GITHUB_REPOSITORY');
  process.exit(1);
}

const SCAN_PATHS = ['.planning/', '.claude/', '.github/'];

async function fetchPRFiles() {
  const url = `https://api.github.com/repos/${GITHUB_REPOSITORY}/pulls/${PR_NUMBER}/files?per_page=100`;
  const response = await fetch(url, {
    headers: {
      'Authorization': `Bearer ${GITHUB_TOKEN}`,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!response.ok) {
    throw new Error(`GitHub API error: ${response.status} ${response.statusText}`);
  }
  return response.json();
}

function shouldScan(filename) {
  return SCAN_PATHS.some(prefix => filename.startsWith(prefix));
}

async function main() {
  const files = await fetchPRFiles();
  const scannable = files.filter(f => shouldScan(f.filename) && f.status !== 'removed');

  if (scannable.length === 0) {
    console.log('No scannable files in PR diff.');
    process.exit(0);
  }

  let hasBlocking = false;
  let warningCount = 0;

  for (const file of scannable) {
    // Use patch content from API (diff hunks) — available without checking out PR code
    const content = file.patch || '';
    if (!content) continue;

    const result = scanForInjection(content, { external: true });
    if (result.clean) continue;

    if (result.tier === 'high') {
      hasBlocking = true;
      for (const pattern of result.blocked) {
        // GitHub Actions annotation format
        console.log(`::error file=${file.filename}::High-confidence injection pattern detected: ${pattern}`);
      }
    }

    if (result.findings.length > 0) {
      warningCount += result.findings.length;
      for (const pattern of result.findings) {
        console.log(`::warning file=${file.filename}::Medium-confidence injection pattern: ${pattern}`);
      }
    }
  }

  console.log(`\nScan complete: ${scannable.length} files scanned, ${hasBlocking ? 'BLOCKED' : 'PASSED'}, ${warningCount} warnings`);

  if (hasBlocking) {
    console.log('\nHigh-confidence injection detected. PR check failed.');
    console.log('Maintainers can override with: /security-override: <reason>');
    process.exit(1);
  }

  process.exit(0);
}

main().catch(err => {
  console.error(`Security scan failed: ${err.message}`);
  process.exit(1);
});
