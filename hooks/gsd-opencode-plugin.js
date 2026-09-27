/**
 * GSD plugin for OpenCode.
 *
 * OpenCode registers hooks through a JS plugin rather than a settings file, so
 * this is the runtime's equivalent of the two GSD hooks Claude registers in
 * settings.json: bash safety on tool.execute.before, and the update check on
 * session start.
 *
 * It is a thin adapter and nothing else. The allow/deny verdict comes from
 * decide() in the CommonJS safety library — 58 KB of compound-command
 * decomposition with its own test suite — and the update check is the existing
 * hook script, spawned rather than reimplemented. Logic added here would drift
 * from the Claude path and go untested.
 */

import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));

// Installed at <config home>/plugins/gsd-core.js, so the config home is one
// level up and the hook payload sits inside the engine tree beside it.
const configHome = path.join(here, '..');

// Same dual-candidate resolution the update-check hook uses: the installed
// layout puts the payload under the engine tree, while in the source tree the
// plugin ships from hooks/ and its siblings are right there.
const defaultHooksDir = (function () {
  const candidates = [path.join(configHome, 'gsd-ng', 'hooks'), here];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, 'bash-safety-hook.cjs'))) return dir;
  }
  return candidates[0];
})();

// The project-local config directory OpenCode reads, used for the two
// project-level settings layers.
const LOCAL_CONFIG_DIR = '.opencode';

// The tool ids that mean "shell execution". OpenCode V2 renamed the shell
// tool id to "shell"; "bash" survives on V1, so both ids match one core
// path rather than forking the decision logic per runtime generation.
const SHELL_TOOLS = new Set(['bash', 'shell']);

// Observed by logging every event.type in a real OpenCode session. Two ids
// count as session start: V2's schema includes session.created but the live
// runtime never delivered it to a plugin subscription on cold start, while
// session.execution.started fires reliably. The per-process closure guard
// below makes the check fire once regardless of how many triggers arrive.
// The server-connection event this constant previously named never appears
// in the stream at all, so nothing fired. The factory runs once per process
// and before any session exists, which is earlier than session start, so a
// discriminant is needed rather than running the check in the factory body.
const SESSION_START_EVENTS = new Set([
  'session.created',
  'session.execution.started',
]);

const COMMAND_MANIFEST_SCHEMA = 1;
const COMMAND_NAME_RE = /^gsd-[a-z0-9-]+$/;

function validateCommandManifest(manifest) {
  if (
    !manifest ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest) ||
    manifest.schema_version !== COMMAND_MANIFEST_SCHEMA ||
    !Array.isArray(manifest.commands)
  ) {
    throw new Error(
      'OpenCode command manifest has an unsupported shape or schema',
    );
  }

  const names = new Set();
  const validated = [];
  for (const record of manifest.commands) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new Error('OpenCode command record must be an object');
    }
    const keys = Object.keys(record).sort();
    const expectedKeys = [
      'argument_mode',
      'description',
      'name',
      'preludes',
      'route',
      'template',
    ];
    if (JSON.stringify(keys) !== JSON.stringify(expectedKeys)) {
      throw new Error('OpenCode command record has unknown or missing fields');
    }
    if (
      typeof record.name !== 'string' ||
      !COMMAND_NAME_RE.test(record.name) ||
      names.has(record.name)
    ) {
      throw new Error(
        `OpenCode command manifest has invalid or duplicate command name ${record.name}`,
      );
    }
    names.add(record.name);
    if (
      typeof record.description !== 'string' ||
      record.description.length === 0 ||
      typeof record.template !== 'string'
    ) {
      throw new Error(
        `OpenCode command record ${record.name} has invalid text fields`,
      );
    }
    if (!['replace', 'append'].includes(record.argument_mode)) {
      throw new Error(
        `OpenCode command record ${record.name} has invalid argument mode`,
      );
    }
    const placeholderCount = (record.template.match(/\$ARGUMENTS/g) || [])
      .length;
    if (
      (record.argument_mode === 'replace' && placeholderCount !== 1) ||
      (record.argument_mode === 'append' && placeholderCount !== 0)
    ) {
      throw new Error(
        `OpenCode command record ${record.name} has an invalid argument placeholder count`,
      );
    }
    const route = record.route;
    const currentRoute =
      route &&
      typeof route === 'object' &&
      !Array.isArray(route) &&
      route.kind === 'current' &&
      Object.keys(route).length === 1;
    const plannerRoute =
      route &&
      typeof route === 'object' &&
      !Array.isArray(route) &&
      route.kind === 'planner' &&
      route.agent === 'gsd-planner' &&
      Object.keys(route).length === 2;
    if (!currentRoute && !plannerRoute) {
      throw new Error(
        `OpenCode command record ${record.name} has an invalid route`,
      );
    }
    if (!Array.isArray(record.preludes)) {
      throw new Error(
        `OpenCode command record ${record.name} has invalid preludes`,
      );
    }
    const tokens = new Set();
    for (const prelude of record.preludes) {
      if (
        !prelude ||
        typeof prelude !== 'object' ||
        Array.isArray(prelude) ||
        JSON.stringify(Object.keys(prelude).sort()) !==
          JSON.stringify(['argv', 'operation', 'token']) ||
        typeof prelude.token !== 'string' ||
        !/^<gsd-prelude-output index="\d+">$/.test(prelude.token) ||
        tokens.has(prelude.token) ||
        prelude.operation !== 'gsd-tools' ||
        !Array.isArray(prelude.argv) ||
        !ALLOWED_PRELUDE_ARGV.has(prelude.argv.join('\0'))
      ) {
        throw new Error(
          `OpenCode command record ${record.name} has an invalid prelude`,
        );
      }
      tokens.add(prelude.token);
      if (record.template.split(prelude.token).length - 1 !== 1) {
        throw new Error(
          `OpenCode command record ${record.name} has a mismatched prelude token`,
        );
      }
    }
    const templateTokens = record.template.match(PRELUDE_TOKEN_RE) || [];
    if (
      templateTokens.length !== tokens.size ||
      templateTokens.some((token) => !tokens.has(token))
    ) {
      throw new Error(
        `OpenCode command record ${record.name} has an undeclared prelude token`,
      );
    }
    validated.push(record);
  }
  return validated;
}

const PRELUDE_TOKEN_RE = /<gsd-prelude-output index="\d+">/g;
const ALLOWED_PRELUDE_ARGV = new Set([
  'cleanup\0--dry-run',
  'cleanup',
  'update\0--dry-run',
]);

function readCommandManifest(deps) {
  if (deps.commandManifest !== undefined) {
    return validateCommandManifest(deps.commandManifest);
  }
  const manifestPath =
    deps.commandManifestPath ||
    path.join(configHome, 'gsd-ng', 'opencode-commands.json');
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  } catch (error) {
    throw new Error(
      `OpenCode command manifest could not be loaded: ${error.message}`,
    );
  }
  return validateCommandManifest(parsed);
}

function runPrelude(spawnFn, nodeExec, toolsPath, prelude) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(nodeExec, [toolsPath, ...prelude.argv], {
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: false,
      });
    } catch (error) {
      reject(error);
      return;
    }
    let stdout = '';
    let stderr = '';
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    if (!child || !child.stdout || !child.stderr || !child.on) {
      fail(
        new Error(
          'OpenCode command prelude did not return a capturable child process',
        ),
      );
      return;
    }
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', fail);
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      if (code !== 0) {
        reject(
          new Error(
            `OpenCode command prelude exited with code ${code}: ${stderr.trim()}`,
          ),
        );
        return;
      }
      resolve(stdout.trim());
    });
  });
}

async function finalizeCommandText(record, input, deps) {
  let text = record.template;
  for (const prelude of record.preludes) {
    const output = await runPrelude(
      deps.spawnFn,
      deps.nodeExec,
      deps.toolsPath,
      prelude,
    );
    text = text.replace(prelude.token, () => output);
  }
  const raw = input.prompt.text;
  if (record.argument_mode === 'replace') {
    return text.replace('$ARGUMENTS', () => raw);
  }
  return raw.length > 0 ? `${text}\n\n${raw}` : text;
}

async function executePlannerCommand(ctx, record, input, finalizedText) {
  try {
    const child = await ctx.session.create({});
    const childID =
      child &&
      (child.id || child.sessionID || (child.data && child.data.id));
    if (typeof childID !== 'string' || childID.length === 0) {
      throw new Error('planner session create returned no child session ID');
    }
    await ctx.session.switchAgent({
      sessionID: childID,
      agent: record.route.agent,
    });
    await ctx.session.prompt({
      sessionID: childID,
      ...input.prompt,
      text: finalizedText,
      delivery: input.delivery,
    });
    await ctx.session.wait({ sessionID: childID });
    const context = await ctx.session.context({ sessionID: childID });
    return await ctx.session.synthetic({
      sessionID: input.sessionID,
      text: typeof context === 'string' ? context : JSON.stringify(context),
    });
  } catch (error) {
    if (ctx.session && typeof ctx.session.synthetic === 'function') {
      try {
        await ctx.session.synthetic({
          sessionID: input.sessionID,
          text: `gsd-planner child routing failed: ${error.message}`,
          description: 'gsd-planner child routing failed',
        });
      } catch (_syntheticError) {
        // The original child-stage failure is the actionable error.
      }
    }
    throw error;
  }
}

/**
 * The interpreter to run the update-check script with.
 *
 * OpenCode loads plugins inside its own Bun-compiled binary, where
 * process.execPath is that binary rather than a Node interpreter — and handing
 * it a script path makes it try to change directory to that path instead of
 * running it, so the check never ran. process.versions.node is set under Bun
 * too, so the runtime is identified by the keys only a non-Node runtime has.
 *
 * @param {object} [versions] - process.versions or a stand-in
 * @param {string} [execPath] - process.execPath or a stand-in
 * @returns {string} the running interpreter when it is Node, else node on PATH
 */
export function resolveNodeExec(versions, execPath) {
  const v = versions || {};
  if (v.bun || v.deno) return 'node';
  return execPath || 'node';
}

const { decide, loadMergedSettings } = require(
  path.join(defaultHooksDir, 'bash-safety-hook.cjs'),
);

/**
 * The merged settings for the runtime this plugin is installed under.
 *
 * Called bare, loadMergedSettings resolves four hardcoded .claude paths, which
 * under OpenCode means decide() would judge every command against a Claude
 * user's rules or nobody's. The config home is passed explicitly for that
 * reason.
 */
function loadRuntimeSettings(projectDir) {
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  return loadMergedSettings(env, {
    globalConfigDir: configHome,
    localConfigDirName: LOCAL_CONFIG_DIR,
    projectDir:
      validProjectRoot(projectDir) ||
      validProjectRoot(env.GSD_PROJECT_DIR) ||
      '',
  });
}

function validProjectRoot(value) {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function v2ProjectRoot(ctx) {
  const project = ctx && ctx.location && ctx.location.project;
  return validProjectRoot(project && project.directory);
}

function v1ProjectRoot(ctx) {
  return validProjectRoot(ctx && ctx.project && ctx.project.worktree);
}

/**
 * Build the hooks object. Dependencies are injectable so the adapters can be
 * driven without an OpenCode process; each defaults to the real one, so calling
 * this with nothing is the production path.
 *
 * @param {object} [deps]
 * @param {Function} [deps.decide] - Allow/deny/passthrough decision function
 * @param {Function} [deps.loadSettings] - Returns merged settings
 * @param {Function} [deps.spawnFn] - child_process.spawn stand-in
 * @param {string} [deps.hooksDir] - Directory holding the update-check script
 * @param {string} [deps.nodeExec] - Interpreter to run the update check with
 * @param {string} [deps.projectDir] - Project root supplied by the runtime
 */
export function createGsdHooks(deps = {}) {
  const decideFn = deps.decide || decide;
  const loadSettings =
    deps.loadSettings || (() => loadRuntimeSettings(deps.projectDir));
  const spawnFn = deps.spawnFn || spawn;
  const hooksDir = deps.hooksDir || defaultHooksDir;
  const nodeExec =
    deps.nodeExec || resolveNodeExec(process.versions, process.execPath);

  // OpenCode loads the plugin once per process and calls the factory once, so
  // this closure is a per-process guard. Each seam instance gets its own, which
  // keeps tests independent of each other.
  let updateChecked = false;

  return {
    async event(input) {
      const event = input && input.event;
      if (!event || !SESSION_START_EVENTS.has(event.type)) return;
      if (updateChecked) return;
      updateChecked = true;

      try {
        const child = spawnFn(
          nodeExec,
          [path.join(hooksDir, 'gsd-check-update.js')],
          { stdio: ['pipe', 'ignore', 'ignore'], detached: true },
        );
        // A PATH lookup that finds nothing reports asynchronously, and an
        // unhandled error event on a child or its stdin ends the process the
        // session runs in. Both are swallowed for the same reason as the catch.
        if (child && child.on) child.on('error', () => {});
        // The script gates on source === 'startup' and times its stdin read out
        // after 3000 ms, so the payload is written and the stream ended now.
        if (child && child.stdin) {
          if (child.stdin.on) child.stdin.on('error', () => {});
          child.stdin.end(JSON.stringify({ source: 'startup' }));
        }
        if (child && child.unref) child.unref();
      } catch (_e) {
        // An update check that fails must never take a session down.
      }
    },

    async 'tool.execute.before'(input, output) {
      if (!input || !SHELL_TOOLS.has(input.tool)) return;
      const command = (output && output.args && output.args.command) || '';
      if (!command) return;

      let result;
      try {
        result = decideFn(command, loadSettings());
      } catch (_e) {
        // Unreadable settings or a decision that blew up is not a verdict.
        // The Claude hook degrades the same way rather than blocking the tool.
        return;
      }

      if (result && result.decision === 'deny') {
        // Throwing here blocks the call. The wording is the reason the Claude
        // hook writes to its permissionDecisionReason — one text, both runtimes.
        throw new Error(result.reason || 'Command denied by pattern');
      }
    },
  };
}

/**
 * Build the V2 setup function. The core hooks are created once here so the
 * once-per-process update-check guard lives exactly as long as the plugin
 * instance, matching V1's factory-runs-once-per-process semantics.
 *
 * The adapter maps V2's single mutable hook event onto the core's
 * (input, output) shape: the tool id and the command come in as
 * `event.tool` and `event.input.command`.
 *
 * @param {object} [deps] - same injectable seams as createGsdHooks
 * @returns {Function} an async setup(ctx) per the V2 plugin contract
 */
export function createV2Adapter(deps = {}) {
  // A reload can run setup again on this adapter before the old instance is
  // unloaded; retire the previous registration and subscription first so
  // hooks never stack and only one stream feeds the core.
  let retirePrevious = async () => {};
  let hooks;

  return async function setup(ctx) {
    await retirePrevious();

    const commandRecords = readCommandManifest(deps);
    const commandDeps = {
      spawnFn: deps.spawnFn || spawn,
      nodeExec:
        deps.nodeExec || resolveNodeExec(process.versions, process.execPath),
      toolsPath:
        deps.toolsPath ||
        path.join(configHome, 'gsd-ng', 'bin', 'gsd-tools.cjs'),
    };

    if (!hooks) {
      hooks = createGsdHooks({
        ...deps,
        // location.directory may be nested below the project. The project
        // metadata names the root whose settings apply to this plugin instance.
        projectDir: v2ProjectRoot(ctx) || deps.projectDir,
      });
    }

    const controller = new AbortController();

    const toolRegistration = await ctx.tool.hook(
      'execute.before',
      async (event) => {
        // Deny must propagate: the throw inside the core hook IS the block,
        // so nothing here may swallow it.
        await hooks['tool.execute.before'](
          { tool: event && event.tool },
          { args: { command: event && event.input && event.input.command } },
        );
      },
    );

    const commandRegistrations = [];
    try {
      const registration = await ctx.command.transform((editor) => {
        for (const record of commandRecords) {
          editor.add({
            name: record.name,
            description: record.description,
            async execute(input) {
              if (
                !input ||
                typeof input.sessionID !== 'string' ||
                !input.prompt ||
                typeof input.prompt.text !== 'string'
              ) {
                throw new Error(
                  `OpenCode command ${record.name} received invalid input`,
                );
              }
              const finalizedText = await finalizeCommandText(
                record,
                input,
                commandDeps,
              );
              if (record.route.kind === 'planner') {
                return executePlannerCommand(
                  ctx,
                  record,
                  input,
                  finalizedText,
                );
              }
              return ctx.session.prompt({
                sessionID: input.sessionID,
                ...input.prompt,
                text: finalizedText,
                delivery: input.delivery,
              });
            },
          });
        }
      });
      commandRegistrations.push(registration);
    } catch (error) {
      for (const registration of commandRegistrations) {
        if (registration && typeof registration.dispose === 'function') {
          await registration.dispose();
        }
      }
      if (toolRegistration && typeof toolRegistration.dispose === 'function') {
        await toolRegistration.dispose();
      }
      throw error;
    }

    // The event stream is consumed in the background so registering the
    // tool hook is not gated on the subscription. Every streamed event is
    // forwarded to the core handler; the trigger set and the once-guard
    // inside decide what actually fires.
    (async () => {
      try {
        for await (const evt of ctx.event.subscribe({
          signal: controller.signal,
        })) {
          await hooks.event({ event: evt });
        }
      } catch (err) {
        // A dropped or aborted subscription is never a session failure.
        // A silent drop, though, reads exactly like the "nothing fired"
        // blindness this port replaced, so surface real stream errors.
        if (controller.signal.aborted) return;
        console.error('[gsd-core] update-check event stream failed:', err);
      }
    })();

    const cleanup = () => {
      controller.abort();
    };
    const retireCurrent = async () => {
      cleanup();
      if (toolRegistration && typeof toolRegistration.dispose === 'function') {
        try {
          await toolRegistration.dispose();
        } catch (_e) {
          // A failed dispose is never a session failure either.
        }
      }
      for (const registration of commandRegistrations) {
        if (registration && typeof registration.dispose === 'function') {
          try {
            await registration.dispose();
          } catch (_e) {
            // Command reload cleanup is best-effort like tool-hook cleanup.
          }
        }
      }
    };
    retirePrevious = retireCurrent;

    return retireCurrent;
  };
}

/**
 * Dual V1+V2 entrypoint. V2 reads `id` and `setup()` and ignores
 * `server()`; V1 (>= 1.18.29) calls `default.server()` and gets the
 * legacy hooks object verbatim. The export must be a plain structural
 * object: the installed standalone file cannot resolve
 * `@opencode/plugin`, and the documented Plugin.define is identity anyway.
 */
export default {
  id: 'gsd-core',
  setup: createV2Adapter(),
  async server(ctx) {
    return createGsdHooks({
      // V1's project context calls the active checkout root `worktree`.
      projectDir: v1ProjectRoot(ctx),
    });
  },
};
