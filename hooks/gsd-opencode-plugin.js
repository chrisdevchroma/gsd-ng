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

// Installed at <config home>/plugin/gsd-core.js, so the config home is one
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
function loadRuntimeSettings() {
  return loadMergedSettings(undefined, {
    globalConfigDir: configHome,
    localConfigDirName: LOCAL_CONFIG_DIR,
  });
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
 */
export function createGsdHooks(deps = {}) {
  const decideFn = deps.decide || decide;
  const loadSettings = deps.loadSettings || loadRuntimeSettings;
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
  const hooks = createGsdHooks(deps);
  // A reload can run setup again on this adapter before the old instance is
  // unloaded; retire the previous registration and subscription first so
  // hooks never stack and only one stream feeds the core.
  let retirePrevious = async () => {};

  return async function setup(ctx) {
    await retirePrevious();

    const controller = new AbortController();

    const toolRegistration = await ctx.tool.hook('execute.before', async (event) => {
      // Deny must propagate: the throw inside the core hook IS the block,
      // so nothing here may swallow it.
      await hooks['tool.execute.before'](
        { tool: event && event.tool },
        { args: { command: event && event.input && event.input.command } },
      );
    });

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
    retirePrevious = async () => {
      if (toolRegistration && typeof toolRegistration.dispose === 'function') {
        try {
          await toolRegistration.dispose();
        } catch (_e) {
          // A failed dispose is never a session failure either.
        }
      }
      cleanup();
    };

    return cleanup;
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
  async server() {
    return createGsdHooks();
  },
};
