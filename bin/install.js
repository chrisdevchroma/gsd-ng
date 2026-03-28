#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const crypto = require('crypto');
const { execSync } = require('child_process');

// Colors
const cyan = '\x1b[36m';
const green = '\x1b[32m';
const yellow = '\x1b[33m';
const dim = '\x1b[2m';
const reset = '\x1b[0m';

// Get version from package.json
const pkg = require('../package.json');

// Parse args
const args = process.argv.slice(2);
const hasGlobal = args.includes('--global') || args.includes('-g');
const hasLocal = args.includes('--local') || args.includes('-l');
const hasUninstall = args.includes('--uninstall') || args.includes('-u');
const noSeedPermissionsConfig = args.includes('--no-seed-permissions-config');
let noSeedSandboxConfig = args.includes('--no-seed-sandbox-config');
const runtimeArgIdx = args.findIndex(a => a === '--runtime');
const runtimeArgVal = runtimeArgIdx !== -1 ? args[runtimeArgIdx + 1] : null;
// Runtime is ONLY set via --runtime flag. No implicit default.
// For non-interactive: --runtime is required (validated below).
// For interactive: promptRuntime() sets this before install.
let runtime = runtimeArgVal || null;  // null means "not specified yet"
let isCopilot = runtime === 'copilot';

// Validate --runtime value if provided
if (runtimeArgVal && !['claude', 'copilot'].includes(runtimeArgVal)) {
  console.error(`  ${yellow}Error: Unknown runtime '${runtimeArgVal}'. Use --runtime claude or --runtime copilot${reset}`);
  process.exit(1);
}

/**
 * Convert a pathPrefix (which uses absolute paths for global installs) to a
 * $HOME-relative form for replacing $HOME/.claude/ references in bash code blocks.
 * Preserves $HOME as a shell variable so paths remain portable across machines.
 *
 * For local installs (pathPrefix is a relative path like "./.claude/"), returns
 * a shell expression with fallback chain: $CLAUDE_PROJECT_DIR (hook contexts),
 * git rev-parse --show-toplevel (subdirectories), pwd (fallback).
 */
function toHomePrefix(pathPrefix) {
  const home = os.homedir().replace(/\\/g, '/');
  const normalized = pathPrefix.replace(/\\/g, '/');
  if (normalized.startsWith(home)) {
    return '$HOME' + normalized.slice(home.length);
  }
  // Convert tilde-based paths to $HOME-based paths for bash code blocks
  if (normalized.startsWith('~/')) {
    return '$HOME' + normalized.slice(1);
  }
  // For local installs (relative paths), use a fallback chain so that bash
  // code blocks work in both hook contexts (where CLAUDE_PROJECT_DIR is set)
  // and Bash tool invocations (where it is unset).
  // pathPrefix is like "./.claude/" — extract the dir name and build the correct path.
  // e.g., "./.claude/" → "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/.claude/"
  const dirMatch = normalized.match(/^\.\/(\.[^/]+\/)/);
  if (dirMatch) {
    return '${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}/' + dirMatch[1];
  }
  return normalized;
}

// Helper to get directory name based on runtime
function getDirName(rt) {
  if (rt === 'copilot') return '.github';
  return '.claude';
}

/**
 * Get the config directory path relative to home directory
 * Used for templating hooks that use path.join(homeDir, '<configDir>', ...)
 * @param {string} rt - Runtime ('claude' or 'copilot')
 * @param {boolean} isGlobal - Whether this is a global install
 */
function getConfigDirFromHome(rt, isGlobal) {
  if (rt === 'copilot') {
    return isGlobal ? "'.copilot'" : "'.github'";
  }
  if (!isGlobal) {
    return `'${getDirName(rt)}'`;
  }
  return "'.claude'";
}

/**
 * Get the global config directory
 * @param {string} rt - Runtime ('claude' or 'copilot')
 * @param {string|null} explicitDir - Explicit directory from --config-dir flag
 */
function getGlobalDir(rt, explicitDir = null) {
  if (rt === 'copilot') {
    if (explicitDir) return expandTilde(explicitDir);
    if (process.env.COPILOT_CONFIG_DIR) return expandTilde(process.env.COPILOT_CONFIG_DIR);
    return path.join(os.homedir(), '.copilot');
  }
  // Claude Code: --config-dir > CLAUDE_CONFIG_DIR > ~/.claude
  if (explicitDir) {
    return expandTilde(explicitDir);
  }
  if (process.env.CLAUDE_CONFIG_DIR) {
    return expandTilde(process.env.CLAUDE_CONFIG_DIR);
  }
  return path.join(os.homedir(), '.claude');
}

const banner = '\n' +
  cyan + '   ██████╗ ███████╗██████╗\n' +
  '  ██╔════╝ ██╔════╝██╔══██╗\n' +
  '  ██║  ███╗███████╗██║  ██║\n' +
  '  ██║   ██║╚════██║██║  ██║\n' +
  '  ╚██████╔╝███████║██████╔╝\n' +
  '   ╚═════╝ ╚══════╝╚═════╝\n' +
  dim + '        ███╗   ██╗ ██████╗\n' +
  '        ████╗  ██║██╔════╝\n' +
  '        ██╔██╗ ██║██║  ███╗\n' +
  '        ██║╚██╗██║██║   ██║\n' +
  '        ██║ ╚████║╚██████╔╝\n' +
  '        ╚═╝  ╚═══╝ ╚═════╝' + reset + '\n' +
  '\n' +
  '  gsd-ng ' + dim + 'v' + pkg.version + reset + '\n' +
  '  A meta-prompting, context engineering and spec-driven\n' +
  '  development system for Claude Code.\n';

// Parse --config-dir argument
function parseConfigDirArg() {
  const configDirIndex = args.findIndex(arg => arg === '--config-dir' || arg === '-c');
  if (configDirIndex !== -1) {
    const nextArg = args[configDirIndex + 1];
    // Error if --config-dir is provided without a value or next arg is another flag
    if (!nextArg || nextArg.startsWith('-')) {
      console.error(`  ${yellow}--config-dir requires a path argument${reset}`);
      process.exit(1);
    }
    return nextArg;
  }
  // Also handle --config-dir=value format
  const configDirArg = args.find(arg => arg.startsWith('--config-dir=') || arg.startsWith('-c='));
  if (configDirArg) {
    const value = configDirArg.split('=')[1];
    if (!value) {
      console.error(`  ${yellow}--config-dir requires a non-empty path${reset}`);
      process.exit(1);
    }
    return value;
  }
  return null;
}
const explicitConfigDir = parseConfigDirArg();
const hasHelp = args.includes('--help') || args.includes('-h');
const forceStatusline = args.includes('--force-statusline');

console.log(banner);

if (hasUninstall) {
  console.log(`  ${yellow}Mode: Uninstall${reset}\n`);
}

// Show help if requested
if (hasHelp) {
  console.log(`  ${yellow}Usage:${reset} npx gsd-ng [options]\n\n  ${yellow}Options:${reset}\n    ${cyan}-g, --global${reset}                       Install globally (to ~/.claude)\n    ${cyan}-l, --local${reset}                        Install locally (to current directory)\n    ${cyan}-u, --uninstall${reset}                    Uninstall GSD (requires --global or --local)\n    ${cyan}-c, --config-dir <path>${reset}            Specify custom config directory\n    ${cyan}-h, --help${reset}                         Show this help message\n    ${cyan}--force-statusline${reset}                 Replace existing statusline config\n    ${cyan}--no-seed-permissions-config${reset}       Skip permissions.allow seeding\n    ${cyan}--no-seed-sandbox-config${reset}           Skip sandbox.enabled seeding (permissions still seeded)\n    ${cyan}--runtime <runtime>${reset}                Select runtime: claude or copilot (REQUIRED for non-interactive)\n\n  ${yellow}Examples:${reset}\n    ${dim}# Interactive install (prompts for runtime and location)${reset}\n    npx gsd-ng\n\n    ${dim}# Install Claude runtime globally${reset}\n    npx gsd-ng --runtime claude --global\n\n    ${dim}# Install Claude runtime to current project only${reset}\n    npx gsd-ng --runtime claude --local\n\n    ${dim}# Install for GitHub Copilot CLI (local)${reset}\n    npx gsd-ng --runtime copilot --local\n\n    ${dim}# Install for GitHub Copilot CLI (global)${reset}\n    npx gsd-ng --runtime copilot --global\n\n    ${dim}# Install to custom config directory${reset}\n    npx gsd-ng --runtime claude --global --config-dir ~/.claude-work\n\n    ${dim}# Uninstall GSD globally${reset}\n    npx gsd-ng --runtime claude --global --uninstall\n\n    ${dim}# Uninstall Copilot CLI runtime globally${reset}\n    npx gsd-ng --runtime copilot --global --uninstall\n\n  ${yellow}Notes:${reset}\n    The --config-dir option is useful when you have multiple configurations.\n    It takes priority over the CLAUDE_CONFIG_DIR environment variable.\n    Sandbox mode is enabled by default. Use --no-seed-sandbox-config to skip it.\n`);
  process.exit(0);
}

/**
 * Expand ~ to home directory (shell doesn't expand in env vars passed to node)
 */
function expandTilde(filePath) {
  if (filePath && filePath.startsWith('~/')) {
    return path.join(os.homedir(), filePath.slice(2));
  }
  return filePath;
}

/**
 * Build a hook command path using forward slashes for cross-platform compatibility.
 * On Windows, $HOME is not expanded by cmd.exe/PowerShell, so we use the actual path.
 */
function buildHookCommand(configDir, hookName) {
  // Use forward slashes for Node.js compatibility on all platforms
  const hooksPath = configDir.replace(/\\/g, '/') + '/hooks/' + hookName;
  return `node "${hooksPath}"`;
}

/**
 * Read and parse settings.json, returning empty object if it doesn't exist
 */
function readSettings(settingsPath) {
  if (fs.existsSync(settingsPath)) {
    try {
      return JSON.parse(fs.readFileSync(settingsPath, 'utf8'));
    } catch (e) {
      return {};
    }
  }
  return {};
}

/**
 * Write settings.json with proper formatting
 */
function writeSettings(settingsPath, settings) {
  fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + '\n');
}

// Cache for attribution settings (populated once during install)
let attributionCached = undefined;
let attributionResolved = false;

/**
 * Get commit attribution setting
 * @returns {null|undefined|string} null = remove, undefined = keep default, string = custom
 */
function getCommitAttribution() {
  // Return cached value if available
  if (attributionResolved) {
    return attributionCached;
  }

  // Claude Code: read attribution from settings.json
  const settings = readSettings(path.join(getGlobalDir(runtime, explicitConfigDir), 'settings.json'));
  let result;
  if (!settings.attribution || settings.attribution.commit === undefined) {
    result = undefined;
  } else if (settings.attribution.commit === '') {
    result = null;
  } else {
    result = settings.attribution.commit;
  }

  // Cache and return
  attributionCached = result;
  attributionResolved = true;
  return result;
}

/**
 * Process Co-Authored-By lines based on attribution setting
 * @param {string} content - File content to process
 * @param {null|undefined|string} attribution - null=remove, undefined=keep, string=replace
 * @returns {string} Processed content
 */
function processAttribution(content, attribution) {
  if (attribution === null) {
    // Remove Co-Authored-By lines and the preceding blank line
    return content.replace(/(\r?\n){2}Co-Authored-By:.*$/gim, '');
  }
  if (attribution === undefined) {
    return content;
  }
  // Replace with custom attribution (escape $ to prevent backreference injection)
  const safeAttribution = attribution.replace(/\$/g, '$$$$');
  return content.replace(/Co-Authored-By:.*$/gim, `Co-Authored-By: ${safeAttribution}`);
}

/**
 * Recursively copy directory, replacing paths in .md files
 * Deletes existing destDir first to remove orphaned files from previous versions
 * @param {string} srcDir - Source directory
 * @param {string} destDir - Destination directory
 * @param {string} pathPrefix - Path prefix for file references
 * @param {boolean} isCommand - Whether copying command files
 */
function copyWithPathReplacement(srcDir, destDir, pathPrefix, isCommand = false) {
  const dirName = getDirName(runtime);

  // Clean install: remove existing destination to prevent orphaned files
  if (fs.existsSync(destDir)) {
    fs.rmSync(destDir, { recursive: true });
  }
  fs.mkdirSync(destDir, { recursive: true });

  const entries = fs.readdirSync(srcDir, { withFileTypes: true });

  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);

    if (entry.isDirectory()) {
      copyWithPathReplacement(srcPath, destPath, pathPrefix, isCommand);
    } else if (entry.name.endsWith('.md')) {
      // Replace ~/.claude/ and $HOME/.claude/ and ./.claude/ with runtime-appropriate paths
      let content = fs.readFileSync(srcPath, 'utf8');
      const globalClaudeRegex = /~\/\.claude\//g;
      const globalClaudeHomeRegex = /\$HOME\/\.claude\//g;
      const localClaudeRegex = /\.\/\.claude\//g;
      content = content.replace(globalClaudeRegex, toHomePrefix(pathPrefix));
      content = content.replace(globalClaudeHomeRegex, toHomePrefix(pathPrefix));
      content = content.replace(localClaudeRegex, `./${dirName}/`);
      content = processAttribution(content, getCommitAttribution());
      fs.writeFileSync(destPath, content);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Uninstall GSD from the specified directory
 * Removes only GSD-specific files/directories, preserves user content
 * @param {boolean} isGlobal - Whether to uninstall from global or local
 */
function uninstall(isGlobal) {
  const dirName = getDirName(runtime);

  // Get the target directory based on install type
  const targetDir = isGlobal
    ? getGlobalDir(runtime, explicitConfigDir)
    : path.join(process.cwd(), dirName);

  const locationLabel = isGlobal
    ? targetDir.replace(os.homedir(), '~')
    : targetDir.replace(process.cwd(), '.');

  const runtimeLabel = isCopilot ? 'Copilot CLI' : 'Claude Code';
  console.log(`  Uninstalling GSD from ${cyan}${runtimeLabel}${reset} at ${cyan}${locationLabel}${reset}\n`);

  // Check if target directory exists
  if (!fs.existsSync(targetDir)) {
    console.log(`  ${yellow}⚠${reset} Directory does not exist: ${locationLabel}`);
    console.log(`  Nothing to uninstall.\n`);
    return;
  }

  let removedCount = 0;

  if (isCopilot) {
    // 1. Remove GSD skills (skills/gsd-* directories)
    const skillsDir = path.join(targetDir, 'skills');
    if (fs.existsSync(skillsDir)) {
      let skillCount = 0;
      for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
        if (entry.isDirectory() && entry.name.startsWith('gsd-')) {
          fs.rmSync(path.join(skillsDir, entry.name), { recursive: true });
          skillCount++;
        }
      }
      if (skillCount > 0) {
        removedCount++;
        console.log(`  ${green}✓${reset} Removed ${skillCount} Copilot skills`);
      }
    }

    // 2. Remove gsd-ng engine directory
    const gsdDir = path.join(targetDir, 'gsd-ng');
    if (fs.existsSync(gsdDir)) {
      fs.rmSync(gsdDir, { recursive: true });
      removedCount++;
      console.log(`  ${green}✓${reset} Removed gsd-ng/`);
    }

    // 3. Remove GSD agents (gsd-*.agent.md)
    const agentsDir = path.join(targetDir, 'agents');
    if (fs.existsSync(agentsDir)) {
      let agentCount = 0;
      for (const file of fs.readdirSync(agentsDir)) {
        if (file.startsWith('gsd-') && file.endsWith('.agent.md')) {
          fs.unlinkSync(path.join(agentsDir, file));
          agentCount++;
        }
      }
      if (agentCount > 0) {
        removedCount++;
        console.log(`  ${green}✓${reset} Removed ${agentCount} Copilot agents`);
      }
    }

    // 4. Clean GSD section from copilot-instructions.md
    const instructionsPath = path.join(targetDir, 'copilot-instructions.md');
    if (fs.existsSync(instructionsPath)) {
      const content = fs.readFileSync(instructionsPath, 'utf8');
      const cleaned = stripGsdFromCopilotInstructions(content);
      if (cleaned === null) {
        fs.unlinkSync(instructionsPath);
        removedCount++;
        console.log(`  ${green}✓${reset} Removed copilot-instructions.md (was GSD-only)`);
      } else if (cleaned !== content) {
        fs.writeFileSync(instructionsPath, cleaned);
        removedCount++;
        console.log(`  ${green}✓${reset} Cleaned GSD section from copilot-instructions.md`);
      }
    }

    // 5. Remove gsd-hooks.json
    const gsdHooksPath = path.join(targetDir, 'hooks', 'gsd-hooks.json');
    if (fs.existsSync(gsdHooksPath)) {
      fs.unlinkSync(gsdHooksPath);
      removedCount++;
      console.log(`  ${green}✓${reset} Removed hooks/gsd-hooks.json`);
    }

    // Print summary and return (no settings.json cleanup for Copilot)
    if (removedCount === 0) {
      console.log(`  ${yellow}⚠${reset} No GSD files found to remove`);
    } else {
      console.log(`\n  ${green}✓${reset} Uninstalled ${removedCount} GSD component(s)`);
    }
    return;
  }

  // 1. Remove GSD commands
  const gsdCommandsDir = path.join(targetDir, 'commands', 'gsd');
  if (fs.existsSync(gsdCommandsDir)) {
    fs.rmSync(gsdCommandsDir, { recursive: true });
    removedCount++;
    console.log(`  ${green}✓${reset} Removed commands/gsd/`);
  }

  // 2. Remove gsd-ng directory
  const gsdDir = path.join(targetDir, 'gsd-ng');
  if (fs.existsSync(gsdDir)) {
    fs.rmSync(gsdDir, { recursive: true });
    removedCount++;
    console.log(`  ${green}✓${reset} Removed gsd-ng/`);
  }

  // 3. Remove GSD agents (gsd-*.md files only)
  const agentsDir = path.join(targetDir, 'agents');
  if (fs.existsSync(agentsDir)) {
    const files = fs.readdirSync(agentsDir);
    let agentCount = 0;
    for (const file of files) {
      if (file.startsWith('gsd-') && file.endsWith('.md')) {
        fs.unlinkSync(path.join(agentsDir, file));
        agentCount++;
      }
    }
    if (agentCount > 0) {
      removedCount++;
      console.log(`  ${green}✓${reset} Removed ${agentCount} GSD agents`);
    }
  }

  // 4. Remove GSD hooks
  const hooksDir = path.join(targetDir, 'hooks');
  if (fs.existsSync(hooksDir)) {
    const gsdHooks = ['gsd-statusline.js', 'gsd-check-update.js', 'gsd-check-update.sh', 'gsd-context-monitor.js', 'gsd-sandbox-detect.js', 'gsd-guardrail.js'];
    let hookCount = 0;
    for (const hook of gsdHooks) {
      const hookPath = path.join(hooksDir, hook);
      if (fs.existsSync(hookPath)) {
        fs.unlinkSync(hookPath);
        hookCount++;
      }
    }
    if (hookCount > 0) {
      removedCount++;
      console.log(`  ${green}✓${reset} Removed ${hookCount} GSD hooks`);
    }
  }

  // 5. Remove GSD package.json (CommonJS mode marker)
  const pkgJsonPath = path.join(targetDir, 'package.json');
  if (fs.existsSync(pkgJsonPath)) {
    try {
      const content = fs.readFileSync(pkgJsonPath, 'utf8').trim();
      // Only remove if it's our minimal CommonJS marker
      if (content === '{"type":"commonjs"}') {
        fs.unlinkSync(pkgJsonPath);
        removedCount++;
        console.log(`  ${green}✓${reset} Removed GSD package.json`);
      }
    } catch (e) {
      // Ignore read errors
    }
  }

  // 6. Clean up settings.json (remove GSD hooks and statusline)
  const settingsPath = path.join(targetDir, 'settings.json');
  if (fs.existsSync(settingsPath)) {
    let settings = readSettings(settingsPath);
    let settingsModified = false;

    // Remove GSD statusline if it references our hook
    if (settings.statusLine && settings.statusLine.command &&
        settings.statusLine.command.includes('gsd-statusline')) {
      delete settings.statusLine;
      settingsModified = true;
      console.log(`  ${green}✓${reset} Removed GSD statusline from settings`);
    }

    // Remove GSD hooks from SessionStart
    if (settings.hooks && settings.hooks.SessionStart) {
      const before = settings.hooks.SessionStart.length;
      settings.hooks.SessionStart = settings.hooks.SessionStart.filter(entry => {
        if (entry.hooks && Array.isArray(entry.hooks)) {
          // Filter out GSD hooks
          const hasGsdHook = entry.hooks.some(h =>
            h.command && (h.command.includes('gsd-check-update') || h.command.includes('gsd-statusline'))
          );
          return !hasGsdHook;
        }
        return true;
      });
      if (settings.hooks.SessionStart.length < before) {
        settingsModified = true;
        console.log(`  ${green}✓${reset} Removed GSD hooks from settings`);
      }
      // Clean up empty array
      if (settings.hooks.SessionStart.length === 0) {
        delete settings.hooks.SessionStart;
      }
    }

    // Remove GSD hooks from PostToolUse
    for (const eventName of ['PostToolUse']) {
      if (settings.hooks && settings.hooks[eventName]) {
        const before = settings.hooks[eventName].length;
        settings.hooks[eventName] = settings.hooks[eventName].filter(entry => {
          if (entry.hooks && Array.isArray(entry.hooks)) {
            const hasGsdHook = entry.hooks.some(h =>
              h.command && h.command.includes('gsd-context-monitor')
            );
            return !hasGsdHook;
          }
          return true;
        });
        if (settings.hooks[eventName].length < before) {
          settingsModified = true;
          console.log(`  ${green}✓${reset} Removed context monitor hook from settings`);
        }
        if (settings.hooks[eventName].length === 0) {
          delete settings.hooks[eventName];
        }
      }
    }

    // Remove GSD hooks from PreToolUse (gsd-sandbox-detect.js, gsd-guardrail.js)
    if (settings.hooks && settings.hooks.PreToolUse) {
      const before = settings.hooks.PreToolUse.length;
      settings.hooks.PreToolUse = settings.hooks.PreToolUse.filter(entry => {
        if (entry.hooks && Array.isArray(entry.hooks)) {
          const hasGsdHook = entry.hooks.some(h =>
            h.command && (h.command.includes('gsd-sandbox-detect') || h.command.includes('gsd-guardrail'))
          );
          return !hasGsdHook;
        }
        return true;
      });
      if (settings.hooks.PreToolUse.length < before) {
        settingsModified = true;
        console.log(`  ${green}✓${reset} Removed GSD PreToolUse hooks from settings`);
      }
      if (settings.hooks.PreToolUse.length === 0) {
        delete settings.hooks.PreToolUse;
      }
    }

    // Remove GSD-seeded permissions.allow entries
    if (settings.permissions && Array.isArray(settings.permissions.allow)) {
      const sandboxTemplatePath = path.join(__dirname, '..', 'gsd-ng', 'templates', 'settings-sandbox.json');
      try {
        let templateEntries = [];
        if (fs.existsSync(sandboxTemplatePath)) {
          const sandboxTemplate = JSON.parse(fs.readFileSync(sandboxTemplatePath, 'utf8'));
          templateEntries = sandboxTemplate.permissions?.allow ?? [];
        }

        // Also compute dynamic platform CLI entries for removal
        const platformCLIs = ['gh', 'glab', 'fj', 'tea'];
        const dynamicEntries = [];
        for (const cli of platformCLIs) {
          try {
            execSync(`which ${cli}`, { stdio: 'ignore', timeout: 2000 });
            dynamicEntries.push(`Bash(${cli} *)`);
          } catch {
            // CLI not installed — skip
          }
        }

        const removalSet = new Set([...templateEntries, ...dynamicEntries]);
        const before = settings.permissions.allow.length;
        settings.permissions.allow = settings.permissions.allow.filter(e => !removalSet.has(e));

        if (settings.permissions.allow.length < before) {
          settingsModified = true;
          console.log(`  ${green}✓${reset} Removed GSD permissions from settings`);
        }

        // Clean up empty structures
        if (settings.permissions.allow.length === 0) {
          delete settings.permissions.allow;
        }
        if (settings.permissions && Object.keys(settings.permissions).length === 0) {
          delete settings.permissions;
        }
      } catch {
        // Template missing or unreadable — skip
      }
    }

    // Clean up empty hooks object
    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    if (settingsModified) {
      writeSettings(settingsPath, settings);
      removedCount++;
    }
  }

  if (removedCount === 0) {
    console.log(`  ${yellow}⚠${reset} No GSD files found to remove.`);
  }

  console.log(`
  ${green}Done!${reset} GSD has been uninstalled from Claude Code.
  Your other files and settings have been preserved.
`);
}

/**
 * Verify a directory exists and contains files
 */
function verifyInstalled(dirPath, description) {
  if (!fs.existsSync(dirPath)) {
    console.error(`  ${yellow}✗${reset} Failed to install ${description}: directory not created`);
    return false;
  }
  try {
    const entries = fs.readdirSync(dirPath);
    if (entries.length === 0) {
      console.error(`  ${yellow}✗${reset} Failed to install ${description}: directory is empty`);
      return false;
    }
  } catch (e) {
    console.error(`  ${yellow}✗${reset} Failed to install ${description}: ${e.message}`);
    return false;
  }
  return true;
}

/**
 * Verify a file exists
 */
function verifyFileInstalled(filePath, description) {
  if (!fs.existsSync(filePath)) {
    console.error(`  ${yellow}✗${reset} Failed to install ${description}: file not created`);
    return false;
  }
  return true;
}

/**
 * Install to the specified directory
 * @param {boolean} isGlobal - Whether to install globally or locally
 */

// ──────────────────────────────────────────────────────
// Local Patch Persistence
// ──────────────────────────────────────────────────────

const PATCHES_DIR_NAME = 'gsd-local-patches';
const MANIFEST_NAME = 'gsd-file-manifest.json';

/**
 * Compute SHA256 hash of file contents
 */
function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

/**
 * Recursively collect all files in dir with their hashes
 */
function generateManifest(dir, baseDir) {
  if (!baseDir) baseDir = dir;
  const manifest = {};
  if (!fs.existsSync(dir)) return manifest;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    if (entry.isDirectory()) {
      Object.assign(manifest, generateManifest(fullPath, baseDir));
    } else {
      manifest[relPath] = fileHash(fullPath);
    }
  }
  return manifest;
}

/**
 * Write file manifest after installation for future modification detection
 */
function writeManifest(configDir) {
  const gsdDir = path.join(configDir, 'gsd-ng');
  const commandsDir = path.join(configDir, 'commands', 'gsd');
  const agentsDir = path.join(configDir, 'agents');
  const manifest = { version: pkg.version, timestamp: new Date().toISOString(), files: {} };

  const gsdHashes = generateManifest(gsdDir);
  for (const [rel, hash] of Object.entries(gsdHashes)) {
    manifest.files['gsd-ng/' + rel] = hash;
  }
  if (fs.existsSync(commandsDir)) {
    const cmdHashes = generateManifest(commandsDir);
    for (const [rel, hash] of Object.entries(cmdHashes)) {
      manifest.files['commands/gsd/' + rel] = hash;
    }
  }
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (file.startsWith('gsd-') && file.endsWith('.md')) {
        manifest.files['agents/' + file] = fileHash(path.join(agentsDir, file));
      }
    }
  }

  fs.writeFileSync(path.join(configDir, MANIFEST_NAME), JSON.stringify(manifest, null, 2));
  return manifest;
}

/**
 * Detect user-modified GSD files by comparing against install manifest.
 * Backs up modified files to gsd-local-patches/ for reapply after update.
 */
function saveLocalPatches(configDir) {
  const manifestPath = path.join(configDir, MANIFEST_NAME);
  if (!fs.existsSync(manifestPath)) return [];

  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { return []; }

  const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
  const modified = [];

  for (const [relPath, originalHash] of Object.entries(manifest.files || {})) {
    const fullPath = path.join(configDir, relPath);
    if (!fs.existsSync(fullPath)) continue;
    const currentHash = fileHash(fullPath);
    if (currentHash !== originalHash) {
      const backupPath = path.join(patchesDir, relPath);
      fs.mkdirSync(path.dirname(backupPath), { recursive: true });
      fs.copyFileSync(fullPath, backupPath);
      modified.push(relPath);
    }
  }

  if (modified.length > 0) {
    const meta = {
      backed_up_at: new Date().toISOString(),
      from_version: manifest.version,
      files: modified
    };
    fs.writeFileSync(path.join(patchesDir, 'backup-meta.json'), JSON.stringify(meta, null, 2));
    const _isUnderCwd = configDir.startsWith(process.cwd() + path.sep) || configDir === process.cwd();
    const patchesDisplayPath = (_isUnderCwd ? configDir.replace(process.cwd(), '.') : configDir.replace(os.homedir(), '~')) + '/' + PATCHES_DIR_NAME + '/';
    console.log('  ' + yellow + 'i' + reset + '  Found ' + modified.length + ' locally modified GSD file(s) — backed up to ' + patchesDisplayPath);
    for (const f of modified) {
      console.log('     ' + dim + f + reset);
    }
  }
  return modified;
}

/**
 * After install, report backed-up patches for user to reapply.
 */
function reportLocalPatches(configDir) {
  const patchesDir = path.join(configDir, PATCHES_DIR_NAME);
  const metaPath = path.join(patchesDir, 'backup-meta.json');
  if (!fs.existsSync(metaPath)) return [];

  let meta;
  try { meta = JSON.parse(fs.readFileSync(metaPath, 'utf8')); } catch { return []; }

  if (meta.files && meta.files.length > 0) {
    const reapplyCommand = '/gsd:reapply-patches';
    console.log('');
    console.log('  ' + yellow + 'Local patches detected' + reset + ' (from v' + meta.from_version + '):');
    for (const f of meta.files) {
      console.log('     ' + cyan + f + reset);
    }
    console.log('');
    const _isUnderCwd = configDir.startsWith(process.cwd() + path.sep) || configDir === process.cwd();
    const patchesDisplayPath = (_isUnderCwd ? configDir.replace(process.cwd(), '.') : configDir.replace(os.homedir(), '~')) + '/' + PATCHES_DIR_NAME + '/';
    console.log('  Your modifications are saved in ' + cyan + patchesDisplayPath + reset);
    console.log('  Run ' + cyan + reapplyCommand + reset + ' to merge them into the new version.');
    console.log('  Or manually compare and merge the files.');
    console.log('');
  }
  return meta.files || [];
}

// ─── Content Conversion Engine (Claude → Copilot) ────────────────────────────

/**
 * Tool name mapping from Claude Code tool names to Copilot tool identifiers.
 * Used when converting Claude command/agent files to Copilot skill/agent format.
 */
const claudeToCopilotTools = {
  Read: 'read',
  Write: 'edit',
  Edit: 'edit',
  Bash: 'execute',
  Grep: 'search',
  Glob: 'search',
  Task: 'agent',
  WebSearch: 'web',
  WebFetch: 'web',
  TodoWrite: 'todo',
  AskUserQuestion: 'ask_user',
  SlashCommand: 'skill',
};

/** HTML comment markers wrapping the GSD-managed block in copilot-instructions.md */
const GSD_COPILOT_INSTRUCTIONS_MARKER = '<!-- GSD Configuration — managed by get-shit-done installer -->';
const GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER = '<!-- /GSD Configuration -->';

/**
 * Path and reference conversion applied to ALL Copilot content.
 * Converts Claude-specific paths, directory names, and command prefixes to Copilot equivalents.
 * @param {string} content - File content to convert
 * @param {boolean} isGlobal - Whether this is a global install
 * @returns {string} Converted content
 */
function convertClaudeToCopilotContent(content, isGlobal = false) {
  let out = content;

  if (isGlobal) {
    // Global: ~/.claude/ → ~/.copilot/, $HOME/.claude/ → $HOME/.copilot/
    out = out.replace(/~\/\.claude\//g, '~/.copilot/');
    out = out.replace(/\$HOME\/\.claude\//g, '$HOME/.copilot/');
  } else {
    // Local: ~/.claude/ → .github/, $HOME/.claude/ → .github/, ./.claude/ → ./.github/
    out = out.replace(/~\/\.claude\//g, '.github/');
    out = out.replace(/\$HOME\/\.claude\//g, '.github/');
    out = out.replace(/\.\/\.claude\//g, './.github/');
  }

  // Slash command prefix: gsd: → gsd- (applies to all Markdown content)
  out = out.replace(/gsd:/g, 'gsd-');

  // Standalone CLAUDE.md references → copilot-instructions.md
  out = out.replace(/\bCLAUDE\.md\b/g, 'copilot-instructions.md');

  return out;
}

/**
 * Convert a Claude command .md file to Copilot SKILL.md format.
 * Adjusts YAML frontmatter (allowed-tools list → comma-separated string with mapped names)
 * and applies path/reference conversion to the body.
 * @param {string} content - Source command .md content
 * @param {string} skillName - Name of the skill (used for context only)
 * @param {boolean} isGlobal - Whether this is a global install
 * @returns {string} Converted content
 */
function convertClaudeCommandToCopilotSkill(content, skillName, isGlobal) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return convertClaudeToCopilotContent(content, isGlobal);
  }

  let frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // Convert name: field — replace gsd: prefix with gsd- (Copilot skill names cannot contain colons)
  frontmatter = frontmatter.replace(/^(name:\s*)gsd:/m, '$1gsd-');

  // Convert allowed-tools YAML list to comma-separated Copilot format with mapped names
  frontmatter = frontmatter.replace(
    /^allowed-tools:\s*\n((?:[ \t]*-[ \t]*\S+[ \t]*\n?)*)/m,
    (match, listBlock) => {
      const tools = listBlock
        .split('\n')
        .map(line => line.replace(/^[ \t]*-[ \t]*/, '').trim())
        .filter(Boolean)
        .map(t => claudeToCopilotTools[t] || t.toLowerCase());
      return 'allowed-tools: ' + tools.join(', ') + '\n';
    }
  );

  const convertedBody = convertClaudeToCopilotContent(body, isGlobal);
  return '---\n' + frontmatter + '\n---\n' + convertedBody;
}

/**
 * Convert a Claude agent .md to Copilot .agent.md format.
 * Adjusts the tools frontmatter field from space/comma-separated Claude tool names
 * to a JSON array of Copilot tool names.
 * @param {string} content - Source agent .md content
 * @param {boolean} isGlobal - Whether this is a global install
 * @returns {string} Converted content
 */
function convertClaudeAgentToCopilotAgent(content, isGlobal) {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!frontmatterMatch) {
    return convertClaudeToCopilotContent(content, isGlobal);
  }

  let frontmatter = frontmatterMatch[1];
  const body = frontmatterMatch[2];

  // Convert tools: line from space/comma-separated names to JSON array of Copilot names
  frontmatter = frontmatter.replace(
    /^(tools:[ \t]*)(.+)$/m,
    (match, prefix, toolsValue) => {
      const tools = toolsValue
        .split(/[\s,]+/)
        .map(t => t.trim())
        .filter(Boolean)
        .map(t => claudeToCopilotTools[t] || t.toLowerCase());
      return prefix + JSON.stringify(tools);
    }
  );

  const convertedBody = convertClaudeToCopilotContent(body, isGlobal);
  return '---\n' + frontmatter + '\n---\n' + convertedBody;
}

/**
 * Merge the GSD configuration block into copilot-instructions.md.
 * Three cases:
 *   - File doesn't exist: create with markers wrapping templateContent
 *   - File exists with markers: replace content between markers
 *   - File exists without markers: append markers + templateContent at end
 * @param {string} instructionsPath - Absolute path to copilot-instructions.md
 * @param {string} templateContent - GSD configuration block content
 */
function mergeCopilotInstructions(instructionsPath, templateContent) {
  const gsdBlock = GSD_COPILOT_INSTRUCTIONS_MARKER + '\n' +
    templateContent.trim() + '\n' +
    GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER;

  if (!fs.existsSync(instructionsPath)) {
    fs.writeFileSync(instructionsPath, gsdBlock + '\n');
    return;
  }

  const existing = fs.readFileSync(instructionsPath, 'utf8');
  const markerStart = existing.indexOf(GSD_COPILOT_INSTRUCTIONS_MARKER);
  const markerEnd = existing.indexOf(GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER);

  if (markerStart !== -1 && markerEnd !== -1) {
    // Replace content between markers (inclusive)
    const updated = existing.slice(0, markerStart) +
      gsdBlock +
      existing.slice(markerEnd + GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER.length);
    fs.writeFileSync(instructionsPath, updated);
  } else {
    // Append GSD block at end
    const separator = existing.endsWith('\n') ? '\n' : '\n\n';
    fs.writeFileSync(instructionsPath, existing + separator + gsdBlock + '\n');
  }
}

/**
 * Remove the GSD block from copilot-instructions.md content.
 * @param {string} content - File content containing possible GSD markers
 * @returns {string|null} Cleaned content, or null if file should be deleted (was GSD-only)
 */
function stripGsdFromCopilotInstructions(content) {
  const markerStart = content.indexOf(GSD_COPILOT_INSTRUCTIONS_MARKER);
  const markerEnd = content.indexOf(GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER);

  if (markerStart === -1 || markerEnd === -1) {
    return content; // No GSD block found — return unchanged
  }

  const before = content.slice(0, markerStart).trimEnd();
  const after = content.slice(markerEnd + GSD_COPILOT_INSTRUCTIONS_CLOSE_MARKER.length).trimStart();
  const cleaned = [before, after].filter(Boolean).join('\n\n');

  if (!cleaned.trim()) {
    return null; // File was GSD-only — caller should delete it
  }
  return cleaned + '\n';
}

// ─────────────────────────────────────────────────────────────────────────────

function install(isGlobal) {
  const dirName = getDirName(runtime);
  const src = path.join(__dirname, '..');

  // Get the target directory based on install type
  const targetDir = isGlobal
    ? getGlobalDir(runtime, explicitConfigDir)
    : path.join(process.cwd(), dirName);

  const locationLabel = isGlobal
    ? targetDir.replace(os.homedir(), '~')
    : targetDir.replace(process.cwd(), '.');

  // Path prefix for file references in markdown content
  // For global installs: use tilde-based path (~/.claude/) to avoid baking
  // absolute paths (containing OS username) into templates
  // For local installs: use relative
  const pathPrefix = isGlobal
    ? `${targetDir.replace(/\\/g, '/').replace(os.homedir().replace(/\\/g, '/'), '~')}/`
    : `./${dirName}/`;

  const runtimeLabel = isCopilot ? 'Copilot CLI' : 'Claude Code';
  console.log(`  Installing for ${cyan}${runtimeLabel}${reset} to ${cyan}${locationLabel}${reset}\n`);

  // Track installation failures
  const failures = [];

  if (isCopilot) {
    // Copilot: skills (from commands), agents, gsd-ng engine, copilot-instructions.md
    // NO settings.json, NO hooks, NO statusline, NO sandbox seeding

    // 1. Copy gsd-ng skill engine (same as Claude Code)
    const skillSrc = path.join(src, 'gsd-ng');
    const skillDest = path.join(targetDir, 'gsd-ng');
    copyWithPathReplacement(skillSrc, skillDest, pathPrefix);
    if (verifyInstalled(skillDest, 'gsd-ng')) {
      console.log(`  ${green}✓${reset} Installed gsd-ng`);
    } else {
      failures.push('gsd-ng');
    }

    // 2. Convert commands to Copilot skills (skills/gsd-{name}/SKILL.md)
    const commandsSrc = path.join(src, 'commands', 'gsd');
    const skillsDir = path.join(targetDir, 'skills');
    if (fs.existsSync(commandsSrc)) {
      // Clean existing GSD skills
      if (fs.existsSync(skillsDir)) {
        for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
          if (entry.isDirectory() && entry.name.startsWith('gsd-')) {
            fs.rmSync(path.join(skillsDir, entry.name), { recursive: true });
          }
        }
      }
      fs.mkdirSync(skillsDir, { recursive: true });

      const commandFiles = fs.readdirSync(commandsSrc).filter(f => f.endsWith('.md'));
      let skillCount = 0;
      for (const file of commandFiles) {
        const content = fs.readFileSync(path.join(commandsSrc, file), 'utf8');
        const skillName = 'gsd-' + path.basename(file, '.md').replace(/^gsd[:-]/, '');
        const skillDir = path.join(skillsDir, skillName);
        fs.mkdirSync(skillDir, { recursive: true });
        const converted = convertClaudeCommandToCopilotSkill(content, skillName, isGlobal);
        fs.writeFileSync(path.join(skillDir, 'SKILL.md'), converted);
        skillCount++;
      }
      console.log(`  ${green}✓${reset} Installed ${skillCount} Copilot skills`);
    }

    // 3. Convert agents to Copilot .agent.md format
    const agentsSrc = path.join(src, 'agents');
    if (fs.existsSync(agentsSrc)) {
      const agentsDest = path.join(targetDir, 'agents');
      // Clean existing GSD agents
      if (fs.existsSync(agentsDest)) {
        for (const file of fs.readdirSync(agentsDest)) {
          if (file.startsWith('gsd-') && file.endsWith('.agent.md')) {
            fs.unlinkSync(path.join(agentsDest, file));
          }
        }
      }
      fs.mkdirSync(agentsDest, { recursive: true });

      const agentFiles = fs.readdirSync(agentsSrc).filter(f => f.endsWith('.md'));
      let agentCount = 0;
      for (const file of agentFiles) {
        const content = fs.readFileSync(path.join(agentsSrc, file), 'utf8');
        const converted = convertClaudeAgentToCopilotAgent(content, isGlobal);
        const agentName = path.basename(file, '.md') + '.agent.md';
        fs.writeFileSync(path.join(agentsDest, agentName), converted);
        agentCount++;
      }
      console.log(`  ${green}✓${reset} Installed ${agentCount} Copilot agents`);
    }

    // 4. Generate copilot-instructions.md
    const templatePath = path.join(targetDir, 'gsd-ng', 'templates', 'copilot-instructions.md');
    const instructionsPath = path.join(targetDir, 'copilot-instructions.md');
    if (fs.existsSync(templatePath)) {
      const template = fs.readFileSync(templatePath, 'utf8');
      mergeCopilotInstructions(instructionsPath, template);
      console.log(`  ${green}✓${reset} Generated copilot-instructions.md`);
    }

    // 5. Write gsd-hooks.json (SessionStart update-check hook)
    // Note: global Copilot hooks (~/.copilot/hooks/) are not yet supported by Copilot CLI
    // (feature request #1354). Only wire hooks for local installs.
    if (!isGlobal) {
      const hooksDir = path.join(targetDir, 'hooks');
      fs.mkdirSync(hooksDir, { recursive: true });
      const gsdHooksPath = path.join(hooksDir, 'gsd-hooks.json');
      const hookContent = JSON.stringify({
        version: 1,
        hooks: {
          sessionStart: [
            {
              type: 'command',
              bash: `node ${dirName}/gsd-ng/hooks/gsd-check-update.js`,
              cwd: '.',
              timeoutSec: 30,
            }
          ]
        }
      }, null, 2);
      fs.writeFileSync(gsdHooksPath, hookContent);
      console.log(`  ${green}✓${reset} Installed hooks/gsd-hooks.json`);
    } else {
      console.log(`  (hooks skipped — global Copilot hooks not yet supported by Copilot CLI)`);
    }

    // Copilot: no settings.json, no statusline, no sandbox seeding
    if (failures.length > 0) {
      console.log(`\n  ${yellow}⚠ ${failures.length} component(s) failed to install${reset}`);
    }
    return { settingsPath: null, settings: null, statuslineCommand: null, runtime };
  }

  // Save any locally modified GSD files before they get wiped
  saveLocalPatches(targetDir);

  // Claude Code: nested structure in commands/ directory
  const commandsDir = path.join(targetDir, 'commands');
  fs.mkdirSync(commandsDir, { recursive: true });

  const gsdSrc = path.join(src, 'commands', 'gsd');
  const gsdDest = path.join(commandsDir, 'gsd');
  copyWithPathReplacement(gsdSrc, gsdDest, pathPrefix, true);
  if (verifyInstalled(gsdDest, 'commands/gsd')) {
    console.log(`  ${green}✓${reset} Installed commands/gsd`);
  } else {
    failures.push('commands/gsd');
  }

  // Copy gsd-ng skill with path replacement
  const skillSrc = path.join(src, 'gsd-ng');
  const skillDest = path.join(targetDir, 'gsd-ng');
  copyWithPathReplacement(skillSrc, skillDest, pathPrefix);
  if (verifyInstalled(skillDest, 'gsd-ng')) {
    console.log(`  ${green}✓${reset} Installed gsd-ng`);
  } else {
    failures.push('gsd-ng');
  }

  // Copy agents to agents directory
  const agentsSrc = path.join(src, 'agents');
  if (fs.existsSync(agentsSrc)) {
    const agentsDest = path.join(targetDir, 'agents');
    fs.mkdirSync(agentsDest, { recursive: true });

    // Remove old GSD agents (gsd-*.md) before copying new ones
    if (fs.existsSync(agentsDest)) {
      for (const file of fs.readdirSync(agentsDest)) {
        if (file.startsWith('gsd-') && file.endsWith('.md')) {
          fs.unlinkSync(path.join(agentsDest, file));
        }
      }
    }

    // Copy new agents
    const agentEntries = fs.readdirSync(agentsSrc, { withFileTypes: true });
    for (const entry of agentEntries) {
      if (entry.isFile() && entry.name.endsWith('.md')) {
        let content = fs.readFileSync(path.join(agentsSrc, entry.name), 'utf8');
        // Replace ~/.claude/ and $HOME/.claude/ as they are the source of truth in the repo
        const dirRegex = /~\/\.claude\//g;
        const homeDirRegex = /\$HOME\/\.claude\//g;
        content = content.replace(dirRegex, toHomePrefix(pathPrefix));
        content = content.replace(homeDirRegex, toHomePrefix(pathPrefix));
        content = processAttribution(content, getCommitAttribution());
        fs.writeFileSync(path.join(agentsDest, entry.name), content);
      }
    }
    if (verifyInstalled(agentsDest, 'agents')) {
      console.log(`  ${green}✓${reset} Installed agents`);
    } else {
      failures.push('agents');
    }
  }

  // Copy CHANGELOG.md
  const changelogSrc = path.join(src, 'CHANGELOG.md');
  const changelogDest = path.join(targetDir, 'gsd-ng', 'CHANGELOG.md');
  if (fs.existsSync(changelogSrc)) {
    fs.copyFileSync(changelogSrc, changelogDest);
    if (verifyFileInstalled(changelogDest, 'CHANGELOG.md')) {
      console.log(`  ${green}✓${reset} Installed CHANGELOG.md`);
    } else {
      failures.push('CHANGELOG.md');
    }
  }

  // Write VERSION file
  const versionDest = path.join(targetDir, 'gsd-ng', 'VERSION');
  fs.writeFileSync(versionDest, pkg.version);
  if (verifyFileInstalled(versionDest, 'VERSION')) {
    console.log(`  ${green}✓${reset} Wrote VERSION (${pkg.version})`);
  } else {
    failures.push('VERSION');
  }

  // Write package.json to force CommonJS mode for GSD scripts
  // Prevents "require is not defined" errors when project has "type": "module"
  // Node.js walks up looking for package.json - this stops inheritance from project
  const pkgJsonDest = path.join(targetDir, 'package.json');
  fs.writeFileSync(pkgJsonDest, '{"type":"commonjs"}\n');
  console.log(`  ${green}✓${reset} Wrote package.json (CommonJS mode)`);

  // Copy hooks from dist/ (bundled with dependencies)
  // Template paths for the target runtime (replaces '.claude' with correct config dir)
  const hooksSrc = path.join(src, 'hooks', 'dist');
  if (fs.existsSync(hooksSrc)) {
    const hooksDest = path.join(targetDir, 'hooks');
    fs.mkdirSync(hooksDest, { recursive: true });
    const hookEntries = fs.readdirSync(hooksSrc);
    const configDirReplacement = getConfigDirFromHome(runtime, isGlobal);
    for (const entry of hookEntries) {
      const srcFile = path.join(hooksSrc, entry);
      if (fs.statSync(srcFile).isFile()) {
        const destFile = path.join(hooksDest, entry);
        // Template .js files to replace '.claude' with runtime-specific config dir
        if (entry.endsWith('.js')) {
          let content = fs.readFileSync(srcFile, 'utf8');
          content = content.replace(/'\.claude'/g, configDirReplacement);
          fs.writeFileSync(destFile, content);
        } else {
          fs.copyFileSync(srcFile, destFile);
        }
      }
    }
    if (verifyInstalled(hooksDest, 'hooks')) {
      console.log(`  ${green}✓${reset} Installed hooks (bundled)`);
    } else {
      failures.push('hooks');
    }
  }

  if (failures.length > 0) {
    console.error(`\n  ${yellow}Installation incomplete!${reset} Failed: ${failures.join(', ')}`);
    process.exit(1);
  }

  // Write file manifest for future modification detection
  writeManifest(targetDir);
  console.log(`  ${green}✓${reset} Wrote file manifest (${MANIFEST_NAME})`);

  // Report any backed-up local patches
  reportLocalPatches(targetDir);

  // Configure statusline and hooks in settings.json
  const postToolEvent = 'PostToolUse';
  const settingsPath = path.join(targetDir, 'settings.json');
  const settings = readSettings(settingsPath);
  const statuslineCommand = isGlobal
    ? buildHookCommand(targetDir, 'gsd-statusline.js')
    : 'node "$CLAUDE_PROJECT_DIR"/' + dirName + '/hooks/gsd-statusline.js';
  const updateCheckCommand = isGlobal
    ? buildHookCommand(targetDir, 'gsd-check-update.js')
    : 'node "$CLAUDE_PROJECT_DIR"/' + dirName + '/hooks/gsd-check-update.js';
  const contextMonitorCommand = isGlobal
    ? buildHookCommand(targetDir, 'gsd-context-monitor.js')
    : 'node "$CLAUDE_PROJECT_DIR"/' + dirName + '/hooks/gsd-context-monitor.js';
  const sandboxDetectCommand = isGlobal
    ? buildHookCommand(targetDir, 'gsd-sandbox-detect.js')
    : 'node "$CLAUDE_PROJECT_DIR"/' + dirName + '/hooks/gsd-sandbox-detect.js';
  const guardrailCommand = isGlobal
    ? buildHookCommand(targetDir, 'gsd-guardrail.js')
    : 'node "$CLAUDE_PROJECT_DIR"/' + dirName + '/hooks/gsd-guardrail.js';

  // Configure hooks in settings.json
  if (!settings.hooks) {
    settings.hooks = {};
  }

  // Configure SessionStart hook for update checking
  if (!settings.hooks.SessionStart) {
    settings.hooks.SessionStart = [];
  }

  const hasGsdUpdateHook = settings.hooks.SessionStart.some(entry =>
    entry.hooks && entry.hooks.some(h => h.command && h.command.includes('gsd-check-update'))
  );

  if (!hasGsdUpdateHook) {
    settings.hooks.SessionStart.push({
      hooks: [
        {
          type: 'command',
          command: updateCheckCommand
        }
      ]
    });
    console.log(`  ${green}✓${reset} Configured update check hook`);
  }

  // Configure post-tool hook for context window monitoring
  if (!settings.hooks[postToolEvent]) {
    settings.hooks[postToolEvent] = [];
  }

  const hasContextMonitorHook = settings.hooks[postToolEvent].some(entry =>
    entry.hooks && entry.hooks.some(h => h.command && h.command.includes('gsd-context-monitor'))
  );

  if (!hasContextMonitorHook) {
    settings.hooks[postToolEvent].push({
      matcher: 'Bash|Edit|Write|MultiEdit|Agent|Task',
      hooks: [
        {
          type: 'command',
          command: contextMonitorCommand,
          timeout: 10
        }
      ]
    });
    console.log(`  ${green}✓${reset} Configured context window monitor hook`);
  } else {
    // Migration: add matcher/timeout to existing context monitor hooks without them
    for (const entry of settings.hooks[postToolEvent]) {
      if (entry.hooks && entry.hooks.some(h => h.command && h.command.includes('gsd-context-monitor'))) {
        if (!entry.matcher) {
          entry.matcher = 'Bash|Edit|Write|MultiEdit|Agent|Task';
        }
        for (const h of entry.hooks) {
          if (h.command && h.command.includes('gsd-context-monitor') && !h.timeout) {
            h.timeout = 10;
          }
        }
      }
    }
  }

  // Configure PreToolUse hook for sandbox detection
  if (!settings.hooks.PreToolUse) {
    settings.hooks.PreToolUse = [];
  }

  const hasGsdSandboxDetectHook = settings.hooks.PreToolUse.some(entry =>
    entry.hooks && entry.hooks.some(h => h.command && h.command.includes('gsd-sandbox-detect'))
  );

  if (!hasGsdSandboxDetectHook) {
    settings.hooks.PreToolUse.push({
      hooks: [
        {
          type: 'command',
          command: sandboxDetectCommand
        }
      ]
    });
    console.log(`  ${green}✓${reset} Configured sandbox detection hook`);
  }

  // Configure PreToolUse hook for workflow guardrail
  const hasGsdGuardrailHook = settings.hooks.PreToolUse.some(entry =>
    entry.hooks && entry.hooks.some(h => h.command && h.command.includes('gsd-guardrail'))
  );

  if (!hasGsdGuardrailHook) {
    settings.hooks.PreToolUse.push({
      matcher: 'Edit|Write|EnterPlanMode',
      hooks: [
        {
          type: 'command',
          command: guardrailCommand,
        }
      ]
    });
    console.log(`  ${green}✓${reset} Configured workflow guardrail hook`);
  }

  // Seed permissions.allow from settings-sandbox.json template
  if (!noSeedPermissionsConfig && !isCopilot) {
    const sandboxTemplatePath = path.join(src, 'gsd-ng', 'templates', 'settings-sandbox.json');
    try {
      const sandboxTemplate = JSON.parse(fs.readFileSync(sandboxTemplatePath, 'utf8'));
      const templateEntries = sandboxTemplate.permissions?.allow ?? [];

      // Detect platform CLIs dynamically
      const platformCLIs = ['gh', 'glab', 'fj', 'tea'];
      const dynamicEntries = [];
      for (const cli of platformCLIs) {
        try {
          execSync(`which ${cli}`, { stdio: 'ignore', timeout: 2000 });
          dynamicEntries.push(`Bash(${cli} *)`);
        } catch {
          // CLI not installed — skip
        }
      }

      // Also check .planning/config.json for configured platform
      const configPath = path.join(process.cwd(), '.planning', 'config.json');
      try {
        if (fs.existsSync(configPath)) {
          const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
          const platform = config.git?.platform;
          const platformToCli = { github: 'gh', gitlab: 'glab', forgejo: 'fj', gitea: 'tea' };
          if (platform && platformToCli[platform]) {
            const entry = `Bash(${platformToCli[platform]} *)`;
            if (!dynamicEntries.includes(entry)) dynamicEntries.push(entry);
          }
        }
      } catch {
        // config.json missing or unparseable — skip
      }

      // Non-destructive merge: add missing entries, keep existing
      const allNewEntries = [...templateEntries, ...dynamicEntries];
      const existingAllow = settings.permissions?.allow ?? [];
      const entriesToAdd = allNewEntries.filter(e => !existingAllow.includes(e));

      if (entriesToAdd.length > 0) {
        if (!settings.permissions) settings.permissions = {};
        if (!settings.permissions.allow) settings.permissions.allow = [];
        settings.permissions.allow.push(...entriesToAdd);
        console.log(`  ${green}✓${reset} Seeded ${entriesToAdd.length} permissions`);
      } else {
        console.log(`  ${green}✓${reset} Permissions already up to date`);
      }
    } catch {
      // Template missing or unreadable — skip silently
    }
  }

  // Seed sandbox settings by default (opt-out via --no-seed-sandbox-config)
  if (!noSeedSandboxConfig && !isCopilot) {
    const sandboxTemplatePath = path.join(src, 'gsd-ng', 'templates', 'settings-sandbox.json');
    try {
      const sandboxTemplate = JSON.parse(fs.readFileSync(sandboxTemplatePath, 'utf8'));
      let sandboxSeeded = false;

      if (sandboxTemplate.sandbox) {
        if (!settings.sandbox) settings.sandbox = {};
        if (settings.sandbox.enabled === undefined && sandboxTemplate.sandbox.enabled !== undefined) {
          settings.sandbox.enabled = sandboxTemplate.sandbox.enabled;
          sandboxSeeded = true;
        }
        if (settings.sandbox.autoAllowBashIfSandboxed === undefined && sandboxTemplate.sandbox.autoAllowBashIfSandboxed !== undefined) {
          settings.sandbox.autoAllowBashIfSandboxed = sandboxTemplate.sandbox.autoAllowBashIfSandboxed;
          sandboxSeeded = true;
        }
      }

      if (sandboxSeeded) {
        console.log(`  ${green}✓${reset} Enabled sandbox mode`);
      }
    } catch {
      // Template missing or unreadable — skip
    }
  }

  return { settingsPath, settings, statuslineCommand };
}

/**
 * Apply statusline config, then print completion message
 */
function finishInstall(settingsPath, settings, statuslineCommand, shouldInstallStatusline) {
  if (shouldInstallStatusline) {
    settings.statusLine = {
      type: 'command',
      command: statuslineCommand
    };
    console.log(`  ${green}✓${reset} Configured statusline`);
  }

  writeSettings(settingsPath, settings);

  console.log(`
  ${green}Done!${reset} Open a blank directory in Claude Code and run ${cyan}/gsd:new-project${reset}.
`);
}

/**
 * Handle statusline configuration with optional prompt
 */
function handleStatusline(settings, isInteractive, callback) {
  const hasExisting = settings.statusLine != null;

  if (!hasExisting) {
    callback(true);
    return;
  }

  if (forceStatusline) {
    callback(true);
    return;
  }

  if (!isInteractive) {
    console.log(`  ${yellow}⚠${reset} Skipping statusline (already configured)`);
    console.log(`    Use ${cyan}--force-statusline${reset} to replace\n`);
    callback(false);
    return;
  }

  const existingCmd = settings.statusLine.command || settings.statusLine.url || '(custom)';

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  console.log(`
  ${yellow}⚠${reset} Existing statusline detected\n
  Your current statusline:
    ${dim}command: ${existingCmd}${reset}

  GSD includes a statusline showing:
    • Model name
    • Current task (from todo list)
    • Context window usage (color-coded)

  ${cyan}1${reset}) Keep existing
  ${cyan}2${reset}) Replace with GSD statusline
`);

  rl.question(`  Choice ${dim}[1]${reset}: `, (answer) => {
    rl.close();
    const choice = answer.trim() || '1';
    callback(choice === '2');
  });
}

/**
 * Ask whether to enable sandbox mode by default.
 * Only called from the interactive (TTY) installer flow for Claude runtime.
 * Copilot runtime skips this prompt entirely (no sandbox model).
 * Default is YES (Y/n) — user must explicitly type 'n' to opt out.
 * User-facing language says "sandbox mode" not "seed sandbox config".
 */
function askSandboxMode(rl, callback) {
  rl.question('  Enable sandbox mode by default? (Y/n): ', (answer) => {
    const enable = answer.trim().toLowerCase() !== 'n';
    callback(enable);
  });
}

/**
 * Install GSD and finalize (hook registration + statusline)
 */
function installAndFinish(isGlobal, isInteractive) {
  const result = install(isGlobal);
  if (result && result.settingsPath) {
    handleStatusline(result.settings, isInteractive, (shouldInstallStatusline) => {
      finishInstall(result.settingsPath, result.settings, result.statuslineCommand, shouldInstallStatusline);
    });
  } else if (result) {
    // Copilot or other runtime without settings.json
    console.log(`\n  ${green}Done!${reset} GSD installed for ${cyan}${isCopilot ? 'Copilot CLI' : 'your runtime'}${reset}.\n`);
  }
}

/**
 * Prompt for runtime selection.
 * Called FIRST in interactive flow, before location.
 * No default -- user must explicitly choose 1 or 2.
 */
function promptRuntime(callback) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let answered = false;

  rl.on('close', () => {
    if (!answered) {
      answered = true;
      console.log(`\n  ${yellow}Installation cancelled${reset}\n`);
      process.exit(0);
    }
  });

  console.log(`  ${yellow}Which runtime?${reset}\n\n  ${cyan}1${reset}) Claude Code  ${dim}(commands in .claude/)${reset}\n  ${cyan}2${reset}) Copilot CLI   ${dim}(skills in .github/)${reset}\n`);

  rl.question(`  Choice: `, (answer) => {
    answered = true;
    rl.close();
    const choice = answer.trim();
    if (choice === '1') {
      callback('claude');
    } else if (choice === '2') {
      callback('copilot');
    } else {
      console.log(`\n  ${yellow}Invalid choice. Please enter 1 or 2.${reset}\n`);
      promptRuntime(callback);
    }
  });
}

/**
 * Prompt for install location
 */
function promptLocation(callback) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  });

  let answered = false;

  rl.on('close', () => {
    if (!answered) {
      answered = true;
      console.log(`\n  ${yellow}Installation cancelled${reset}\n`);
      process.exit(0);
    }
  });

  const globalPath = getGlobalDir(runtime, explicitConfigDir).replace(os.homedir(), '~');
  const localPath = './' + getDirName(runtime);

  console.log(`  ${yellow}Where would you like to install?${reset}\n\n  ${cyan}1${reset}) Global ${dim}(${globalPath})${reset} - available in all projects\n  ${cyan}2${reset}) Local  ${dim}(${localPath})${reset} - this project only\n`);

  rl.question(`  Choice ${dim}[1]${reset}: `, (answer) => {
    answered = true;
    rl.close();
    const choice = answer.trim() || '1';
    const isGlobal = choice !== '2';
    callback(isGlobal);
  });
}

// Main logic
if (hasGlobal && hasLocal) {
  console.error(`  ${yellow}Cannot specify both --global and --local${reset}`);
  process.exit(1);
} else if (explicitConfigDir && hasLocal) {
  console.error(`  ${yellow}Cannot use --config-dir with --local${reset}`);
  process.exit(1);
} else if (hasUninstall) {
  if (!hasGlobal && !hasLocal) {
    console.error(`  ${yellow}--uninstall requires --global or --local${reset}`);
    process.exit(1);
  }
  if (!runtime) {
    console.error(`  ${yellow}Error: --runtime required. Use --runtime claude or --runtime copilot${reset}`);
    process.exit(1);
  }
  uninstall(hasGlobal);
} else if (hasGlobal || hasLocal) {
  // Non-interactive: --runtime is REQUIRED
  if (!runtime) {
    console.error(`  ${yellow}Error: --runtime required. Use --runtime claude or --runtime copilot${reset}`);
    process.exit(1);
  }
  installAndFinish(hasGlobal, false);
} else {
  // Interactive
  if (!process.stdin.isTTY) {
    console.error(`  ${yellow}Non-interactive terminal detected. Use --runtime with --global or --local.${reset}\n`);
    console.error(`  ${dim}Examples:${reset}\n    npx gsd-ng --runtime claude --global\n    npx gsd-ng --runtime claude --local\n    npx gsd-ng --runtime copilot --local\n`);
    process.exit(1);
  } else {
    // Interactive flow: runtime -> location -> sandbox (Claude only)
    promptRuntime((selectedRuntime) => {
      runtime = selectedRuntime;
      isCopilot = runtime === 'copilot';
      promptLocation((isGlobal) => {
        if (isCopilot) {
          // Copilot has no sandbox model -- skip sandbox prompt
          installAndFinish(isGlobal, true);
        } else {
          // Claude: ask about sandbox mode
          const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
          askSandboxMode(rl, (enableSandbox) => {
            rl.close();
            if (!enableSandbox) {
              noSeedSandboxConfig = true;
            }
            installAndFinish(isGlobal, true);
          });
        }
      });
    });
  }
}
