'use strict';

/**
 * Per-CLI subcommand mappings. Each CLI gets granular subcommand patterns
 * instead of blanket Bash(cli *) wildcards.
 *
 * NOT allowlisted: gh api, glab api (fall through to prompting),
 *                  gh extension (arbitrary code execution risk)
 */
const CLI_SUBCOMMANDS = {
  gh:   ['pr', 'issue', 'release', 'workflow', 'auth', 'repo'],
  glab: ['mr', 'issue', 'release', 'ci', 'auth', 'repo'],
  fj:   ['pr', 'issue', 'release', 'actions', 'auth', 'repo'],
  tea:  ['pr', 'pulls', 'issue', 'issues', 'release', 'releases', 'login', 'repo', 'repos', 'actions'],
};

/**
 * Get granular permission patterns for a platform CLI.
 * Returns both glob form Bash(cli sub *) and exact form Bash(cli sub)
 * so that zero-arg commands are also covered.
 *
 * @param {string} cli - CLI binary name: 'gh', 'glab', 'fj', or 'tea'
 * @returns {string[]} Array of Bash() permission patterns
 */
function getPlatformCliPatterns(cli) {
  const subs = CLI_SUBCOMMANDS[cli];
  if (!subs) return [];
  const patterns = [];
  for (const sub of subs) {
    patterns.push(`Bash(${cli} ${sub} *)`);
    patterns.push(`Bash(${cli} ${sub})`);
  }
  return patterns;
}

/**
 * Get all granular patterns for all platform CLIs.
 * @returns {{ [cli: string]: string[] }}
 */
function getAllPlatformCliPatterns() {
  const result = {};
  for (const cli of Object.keys(CLI_SUBCOMMANDS)) {
    result[cli] = getPlatformCliPatterns(cli);
  }
  return result;
}

/**
 * Platform name to CLI binary mapping.
 * Matches PLATFORM_CLI in commands.cjs.
 */
const PLATFORM_TO_CLI = { github: 'gh', gitlab: 'glab', forgejo: 'fj', gitea: 'tea' };

module.exports = {
  CLI_SUBCOMMANDS,
  PLATFORM_TO_CLI,
  getPlatformCliPatterns,
  getAllPlatformCliPatterns,
};
