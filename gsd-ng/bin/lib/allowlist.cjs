'use strict';

/**
 * Per-CLI subcommand mappings. Each CLI gets granular subcommand patterns
 * instead of blanket Bash(cli *) wildcards.
 *
 * Subcommand narrowing per platform:
 *   - gh repo:   view, list, clone, fork, create, sync, set-default (excludes delete, rename, edit, archive, etc.)
 *   - gh label:  list, create, clone                                (excludes delete, edit)
 *   - glab:      mirrors gh minus missing verbs (no sync/set-default; no label clone)
 *   - fj:        mirrors gh minus missing verbs (no repo list; NO label subcommand exists at all — corrects historical drift)
 *   - tea:       mirrors gh minus missing verbs (no repo view, no repo clone; retains 'repos'/'labels' plural aliases)
 *
 * Existing users keep their broader Bash(<cli> repo *) / Bash(<cli> label *) entries
 * until the manifest migration mechanism delivers granular narrowing.
 *
 * Multi-word entries (e.g. 'repo view') are emitted by getPlatformCliPatterns
 * as literal Bash(gh repo view *) / Bash(gh repo view) permission rules — the
 * template literal handles multi-word tokens via string substitution with no
 * splitting or quoting.
 *
 * NOT allowlisted: gh api, glab api (fall through to prompting),
 *                  gh extension (arbitrary code execution risk),
 *                  ssh-key, gpg-key, config (account-modifying),
 *                  any repo/label delete/rename/edit/archive verb.
 */
const CLI_SUBCOMMANDS = {
  gh: [
    'pr',
    'issue',
    'release',
    'workflow',
    'auth',
    'search',
    'run',
    'status',
    'repo view',
    'repo list',
    'repo clone',
    'repo fork',
    'repo create',
    'repo sync',
    'repo set-default',
    'label list',
    'label create',
    'label clone',
  ],
  glab: [
    'mr',
    'issue',
    'release',
    'ci',
    'auth',
    'repo view',
    'repo list',
    'repo clone',
    'repo fork',
    'repo create',
    'label list',
    'label create',
  ],
  fj: [
    'pr',
    'issue',
    'release',
    'actions',
    'auth',
    'repo view',
    'repo clone',
    'repo fork',
    'repo create',
    // NOTE: fj has no 'label' subcommand — intentionally empty (no label support in this CLI)
  ],
  tea: [
    'pr',
    'pulls',
    'issue',
    'issues',
    'release',
    'releases',
    'login',
    'actions',
    'repo list',
    'repo create',
    'repo fork',
    'label list',
    'label create',
    'repos',
    'labels', // retained plural aliases (broad) — candidate to narrow when manifest migration lands
  ],
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
const PLATFORM_TO_CLI = {
  github: 'gh',
  gitlab: 'glab',
  forgejo: 'fj',
  gitea: 'tea',
};

/**
 * RW_FORMS — canonical Read/Edit/Write permission forms — both bare and glob.
 * Exported as a frozen Set so install.js and commands.cjs can strip these
 * from template entries before injecting the platform-appropriate form.
 * Single source of truth for Read/Edit/Write permission forms.
 */
const RW_FORMS = Object.freeze(
  new Set(['Edit', 'Write', 'Read', 'Edit(*)', 'Write(*)', 'Read(*)']),
);

/**
 * Return the Read/Edit/Write allow entries appropriate for the target platform.
 *
 * - Linux → bare forms ['Edit', 'Write', 'Read']
 *   Workaround for anthropics/claude-code #16170 and #6881: the Linux
 *   permission engine mishandles certain glob-qualified permission rules
 *   (Edit(*), Write(*), Read(*)) and produces startup warnings or
 *   unexpected prompts. Bare forms are the stable Linux workaround.
 *
 * - darwin / win32 / unknown → canonical glob forms ['Edit(*)', 'Write(*)', 'Read(*)']
 *   Canonical macOS form. Windows defaults to canonical pending CC Windows
 *   permission engine research (TODO: revisit if CC behavior is confirmed).
 *
 * Pure function — no I/O, no module state. Returns a fresh array on every
 * call so callers can mutate without leaking into shared state.
 *
 * @param {string} platform  process.platform value ('linux', 'darwin', 'win32', ...)
 * @returns {string[]}       array of permission rule strings (length 3)
 */
function getReadEditWriteAllowRules(platform) {
  if (platform === 'linux') {
    return ['Edit', 'Write', 'Read'];
  }
  return ['Edit(*)', 'Write(*)', 'Read(*)'];
}

module.exports = {
  CLI_SUBCOMMANDS,
  PLATFORM_TO_CLI,
  RW_FORMS,
  getPlatformCliPatterns,
  getAllPlatformCliPatterns,
  getReadEditWriteAllowRules,
};
