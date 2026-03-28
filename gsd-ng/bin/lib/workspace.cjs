/**
 * Workspace — Workspace topology detection and memory helpers
 */

const fs = require('fs');
const path = require('path');
const { output, error } = require('./core.cjs');
const { extractFrontmatter } = require('./frontmatter.cjs');

// ─── Workspace topology detection ────────────────────────────────────────────

/**
 * Parse .gitmodules to extract submodule path= values.
 * @param {string} gitmodulesPath - Absolute path to .gitmodules
 * @returns {string[]} Array of submodule paths (relative to project root)
 */
function parseSubmodulePaths(gitmodulesPath) {
  try {
    const content = fs.readFileSync(gitmodulesPath, 'utf-8');
    const paths = [];
    for (const line of content.split('\n')) {
      const m = line.match(/^\s*path\s*=\s*(.+)$/);
      if (m) paths.push(m[1].trim());
    }
    return paths;
  } catch {
    return [];
  }
}

/**
 * Detect the workspace topology for the given directory.
 *
 * Detection order (first match wins):
 *   1. .gitmodules exists -> submodule
 *   2. pnpm-workspace.yaml exists -> monorepo
 *   3. package.json with workspaces field (array or object) -> monorepo
 *   4. Default -> standalone
 *
 * @param {string} cwd - Directory to inspect
 * @returns {{ type: 'submodule'|'monorepo'|'standalone', signal: string|null, submodule_paths: string[] }}
 */
function detectWorkspaceType(cwd) {
  // 1. Check for git submodules
  if (fs.existsSync(path.join(cwd, '.gitmodules'))) {
    const submodulePaths = parseSubmodulePaths(path.join(cwd, '.gitmodules'));
    return { type: 'submodule', signal: '.gitmodules', submodule_paths: submodulePaths };
  }

  // 2. Check for pnpm workspace
  if (fs.existsSync(path.join(cwd, 'pnpm-workspace.yaml'))) {
    return { type: 'monorepo', signal: 'pnpm-workspace.yaml', submodule_paths: [] };
  }

  // 3. Check package.json for workspaces field
  const pkgPath = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.workspaces) {
        return { type: 'monorepo', signal: 'package.json#workspaces', submodule_paths: [] };
      }
    } catch {
      // Malformed package.json — treat as standalone
    }
  }

  // 4. Default: standalone
  return { type: 'standalone', signal: null, submodule_paths: [] };
}

// ─── Memory section generation ────────────────────────────────────────────────

/**
 * Generate the CLAUDE.md Memories section string from .claude/memory/ files.
 *
 * Reads all .md files (except MEMORY.md), extracts frontmatter description/name,
 * and builds the bullet list section.
 *
 * @param {string} cwd - Project root directory
 * @returns {string} Markdown section string, or '' if no memory directory
 */
function generateMemoriesSection(cwd) {
  const memoryDir = path.join(cwd, '.claude', 'memory');

  if (!fs.existsSync(memoryDir)) {
    return '';
  }

  let files;
  try {
    files = fs.readdirSync(memoryDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      .sort();
  } catch {
    return '';
  }

  if (files.length === 0) {
    return '';
  }

  const bullets = files.map(filename => {
    const filePath = path.join(memoryDir, filename);
    let description = '(no description)';
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fm = extractFrontmatter(content);
      if (fm.description) {
        description = fm.description;
      } else if (fm.name) {
        description = fm.name;
      }
    } catch {
      // Use fallback description
    }
    return `- [.claude/memory/${filename}](.claude/memory/${filename}) — ${description}`;
  });

  return [
    '## Memories',
    '',
    'Read `.claude/memory/` for persistent feedback and project context. Key entries:',
    '',
    ...bullets,
  ].join('\n');
}

/**
 * Generate the MEMORY.md content string from .claude/memory/ files.
 *
 * Groups files by their frontmatter `type` field. Capitalizes group headings.
 * Filters out MEMORY.md itself.
 *
 * @param {string} cwd - Project root directory
 * @returns {string} MEMORY.md content string, or '' if no qualifying files
 */
function generateMemoryMd(cwd) {
  const memoryDir = path.join(cwd, '.claude', 'memory');

  if (!fs.existsSync(memoryDir)) {
    return '';
  }

  let files;
  try {
    files = fs.readdirSync(memoryDir)
      .filter(f => f.endsWith('.md') && f !== 'MEMORY.md')
      .sort();
  } catch {
    return '';
  }

  if (files.length === 0) {
    return '';
  }

  // Build groups
  const groups = {};
  for (const filename of files) {
    const filePath = path.join(memoryDir, filename);
    let description = '(no description)';
    let groupName = 'Other';
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const fm = extractFrontmatter(content);
      if (fm.description) {
        description = fm.description;
      } else if (fm.name) {
        description = fm.name;
      }
      if (fm.type) {
        // Capitalize first letter of type for the group heading
        groupName = fm.type.charAt(0).toUpperCase() + fm.type.slice(1);
      }
    } catch {
      // Use defaults
    }

    if (!groups[groupName]) {
      groups[groupName] = [];
    }
    groups[groupName].push({ filename, description });
  }

  if (Object.keys(groups).length === 0) {
    return '';
  }

  const lines = ['# Memory Index'];
  for (const [groupName, entries] of Object.entries(groups)) {
    lines.push('');
    lines.push(`## ${groupName}`);
    for (const { filename, description } of entries) {
      lines.push(`- [${filename}](${filename}) — ${description}`);
    }
  }

  return lines.join('\n');
}

// ─── Memory template seeding ─────────────────────────────────────────────────

/**
 * Copy a memory template file to the target directory with the given filename.
 *
 * Creates the target directory if it doesn't exist.
 *
 * @param {string} templatePath - Absolute path to the source template file
 * @param {string} targetDir - Directory to seed the memory into
 * @param {string} filename - Filename for the output file
 * @returns {{ seeded: true, path: string } | { seeded: false, reason: string }}
 */
function seedMemoryTemplate(templatePath, targetDir, filename) {
  if (!fs.existsSync(templatePath)) {
    return { seeded: false, reason: 'template not found' };
  }

  try {
    fs.mkdirSync(targetDir, { recursive: true });
    const outputPath = path.join(targetDir, filename);
    fs.copyFileSync(templatePath, outputPath);
    return { seeded: true, path: outputPath };
  } catch (err) {
    return { seeded: false, reason: err.message };
  }
}

// ─── CLI command ──────────────────────────────────────────────────────────────

/**
 * CLI wrapper for detectWorkspaceType. Outputs JSON via output().
 *
 * @param {string} cwd - Working directory
 * @param {boolean} raw - Whether to output raw value
 */
function cmdDetectWorkspace(cwd, raw) {
  const result = detectWorkspaceType(cwd);
  output(result, raw);
}

// ─── Exports ──────────────────────────────────────────────────────────────────

module.exports = {
  detectWorkspaceType,
  generateMemoriesSection,
  generateMemoryMd,
  seedMemoryTemplate,
  cmdDetectWorkspace,
};
