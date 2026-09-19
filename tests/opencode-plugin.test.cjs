'use strict';
/**
 * opencode-plugin.test.cjs
 * Unit coverage for the OpenCode plugin's dual entrypoints: the V1 hooks
 * object returned by server(), and the V2 setup(ctx) adapter, over the
 * shared bash-safety and update-check behaviours.
 *
 * The hook behaviours are driven through the plugin's injectable seam with
 * fake dependencies. The last cases drive the REAL installed plugin against
 * a synthetic config home on disk, because a seam that is only ever tested
 * with injected settings cannot show which settings file production reads.
 */

const { describe, test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');

const { resolveTmpDir, cleanup } = require('./helpers.cjs');

const BASE_TMPDIR = resolveTmpDir();
const HOOKS_DIR = path.resolve(__dirname, '..', 'hooks');
const PLUGIN_PATH = path.join(HOOKS_DIR, 'gsd-opencode-plugin.js');

const SESSION_START_EVENT = 'session.created';
const DENY_COMMAND = 'rm -rf /';
const DENY_PATTERN = 'Bash(rm:*)';

/** Import the plugin module fresh from a given path. */
function importPlugin(pluginPath) {
  return import(pathToFileURL(pluginPath).href);
}

/** A spawn stand-in that records its calls and mimics a piped-stdin child. */
function fakeSpawn() {
  const calls = [];
  const fn = (command, args, options) => {
    const writes = [];
    const child = {
      handlers: [],
      stdin: {
        handlers: [],
        on(name) {
          child.stdin.handlers.push(name);
          return child.stdin;
        },
        end(chunk) {
          if (chunk !== undefined) writes.push(String(chunk));
          child.stdinEnded = true;
        },
        write(chunk) {
          writes.push(String(chunk));
        },
      },
      on(name) {
        child.handlers.push(name);
        return child;
      },
      stdinEnded: false,
      unrefCalled: false,
      unref() {
        child.unrefCalled = true;
      },
    };
    calls.push({ command, args, options, child, writes });
    return child;
  };
  fn.calls = calls;
  return fn;
}

/** decide() stand-in returning a fixed verdict and recording its settings arg. */
function fakeDecide(verdict) {
  const seen = [];
  const fn = (command, settings) => {
    seen.push({ command, settings });
    return verdict;
  };
  fn.seen = seen;
  return fn;
}

/** loadSettings stand-in counting how often the hooks consulted settings. */
function countingSettings(settings) {
  const fn = () => {
    fn.calls += 1;
    return settings;
  };
  fn.calls = 0;
  return fn;
}

async function hooksWith(overrides) {
  const mod = await importPlugin(PLUGIN_PATH);
  return mod.createGsdHooks(overrides);
}

/** An async iterable that yields the given items and terminates naturally. */
async function* fakeAsyncIterable(items) {
  for (const item of items) {
    yield item;
  }
}

/**
 * V2 ctx stand-in: records execute.before registrations and the options
 * handed to event.subscribe, and streams the given events to the adapter.
 */
function fakeCtx(events) {
  const ctx = {
    toolCalls: [],
    subscribeOpts: [],
    tool: {
      async hook(name, cb) {
        ctx.toolCalls.push({ name, cb });
      },
      async list() {
        return [];
      },
    },
    event: {
      subscribe(opts) {
        ctx.subscribeOpts.push(opts);
        return fakeAsyncIterable(events);
      },
    },
  };
  return ctx;
}

/**
 * Build a FRESH V2 adapter with fake deps and run its setup against a fake
 * ctx. A fresh adapter keeps the once-per-process guard per-test; driving
 * spawn-triggering events through the shared module-level setup would make
 * the tests order-dependent. The short drain lets the detached consume
 * loop settle before the caller asserts.
 */
async function v2Setup(overrides, events) {
  const mod = await importPlugin(PLUGIN_PATH);
  const setup = mod.createV2Adapter(overrides);
  const ctx = fakeCtx(events || []);
  const release = await setup(ctx);
  await new Promise((r) => setTimeout(r, 50));
  return { ctx, release };
}

describe('PLUGIN: tool.execute.before adapts decide() to the opencode signature', () => {
  test('PLUGIN-01: the module exports the dual V1+V2 shape', async () => {
    const mod = await importPlugin(PLUGIN_PATH);
    assert.equal(typeof mod.default, 'object', 'default is a plain object');
    assert.ok(mod.default, 'the default export exists');
    assert.equal(mod.default.id, 'gsd-core', 'a stable plugin id');
    assert.equal(typeof mod.default.setup, 'function', 'the V2 setup entrypoint');
    assert.equal(typeof mod.default.server, 'function', 'the V1 server entrypoint');
    assert.equal(typeof mod.createGsdHooks, 'function', 'an injectable seam');
    assert.equal(typeof mod.createV2Adapter, 'function', 'a V2 adapter seam');

    const hooks = await mod.default.server();
    assert.equal(typeof hooks.event, 'function');
    assert.equal(typeof hooks['tool.execute.before'], 'function');
  });

  test('PLUGIN-02: a denied bash command throws with the reason decide() returned', async () => {
    const reason = `Command "${DENY_COMMAND}" matches deny pattern "${DENY_PATTERN}"`;
    const hooks = await hooksWith({
      decide: fakeDecide({ decision: 'deny', reason }),
      loadSettings: countingSettings({ permissions: { allow: [], deny: [] } }),
      spawnFn: fakeSpawn(),
    });

    await assert.rejects(
      () =>
        hooks['tool.execute.before'](
          { tool: 'bash', sessionID: 's', callID: 'c' },
          { args: { command: DENY_COMMAND } },
        ),
      (err) => {
        assert.equal(err.message, reason);
        return true;
      },
    );
  });

  test('PLUGIN-03: an allowed bash command resolves', async () => {
    const hooks = await hooksWith({
      decide: fakeDecide({ decision: 'allow', reason: 'matched allow' }),
      loadSettings: countingSettings({}),
      spawnFn: fakeSpawn(),
    });
    await hooks['tool.execute.before'](
      { tool: 'bash' },
      { args: { command: 'git status' } },
    );
  });

  test('PLUGIN-04: a passthrough decision resolves', async () => {
    const hooks = await hooksWith({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn: fakeSpawn(),
    });
    await hooks['tool.execute.before'](
      { tool: 'bash' },
      { args: { command: 'curl https://example.com' } },
    );
  });

  test('PLUGIN-05: a non-bash tool resolves without consulting settings', async () => {
    const decide = fakeDecide({ decision: 'deny', reason: 'should never run' });
    const loadSettings = countingSettings({});
    const hooks = await hooksWith({ decide, loadSettings, spawnFn: fakeSpawn() });

    await hooks['tool.execute.before'](
      { tool: 'read' },
      { args: { filePath: '/etc/passwd' } },
    );
    assert.equal(loadSettings.calls, 0, 'settings must not be read for a non-bash tool');
    assert.equal(decide.seen.length, 0, 'decide must not run for a non-bash tool');
  });

  test('PLUGIN-06: a missing or empty command resolves without throwing', async () => {
    const decide = fakeDecide({ decision: 'deny', reason: 'should never run' });
    const hooks = await hooksWith({
      decide,
      loadSettings: countingSettings({}),
      spawnFn: fakeSpawn(),
    });

    await hooks['tool.execute.before']({ tool: 'bash' }, { args: {} });
    await hooks['tool.execute.before']({ tool: 'bash' }, { args: { command: '' } });
    await hooks['tool.execute.before']({ tool: 'bash' }, {});
    assert.equal(decide.seen.length, 0, 'an absent command is nothing to decide about');
  });
});

describe('PLUGIN: event() runs the update check once per process', () => {
  test('PLUGIN-07: the session-start event spawns the update check exactly once', async () => {
    const spawnFn = fakeSpawn();
    const hooksDir = path.join(BASE_TMPDIR, 'gsd-plugin-hooks-fake');
    const hooks = await hooksWith({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn,
      hooksDir,
    });

    await hooks.event({ event: { type: SESSION_START_EVENT } });
    assert.equal(spawnFn.calls.length, 1, 'the session-start event runs the check');

    // The event fires once per session; the guard makes the check once per
    // process, so a second session in the same process must add nothing.
    await hooks.event({ event: { type: SESSION_START_EVENT } });
    assert.equal(spawnFn.calls.length, 1, 'the update check runs once per process');
    const call = spawnFn.calls[0];
    assert.equal(call.command, process.execPath, 'node runs the script under node');
    assert.deepEqual(call.args, [path.join(hooksDir, 'gsd-check-update.js')]);
    assert.ok(
      call.child.handlers.includes('error'),
      'a spawn failure reported asynchronously must not reach the session',
    );
    assert.ok(call.child.stdin.handlers.includes('error'), 'nor a broken pipe');
    assert.deepEqual(call.options.stdio, ['pipe', 'ignore', 'ignore']);
    assert.equal(call.options.detached, true);
    assert.equal(
      call.writes.join(''),
      JSON.stringify({ source: 'startup' }),
      'the child is gated on source === startup',
    );
    assert.equal(call.child.stdinEnded, true, 'stdin is ended inside the read window');
    assert.equal(call.child.unrefCalled, true, 'the child outlives the session');
  });

  test('PLUGIN-08: an unrelated event does not spawn', async () => {
    const spawnFn = fakeSpawn();
    const hooks = await hooksWith({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn,
    });

    // message.updated is one of the most frequent events in a live session, so
    // a handler that spawned on everything would still pass the case above.
    await hooks.event({ event: { type: 'message.updated' } });
    await hooks.event({ event: { type: 'message.part.updated' } });
    await hooks.event({ event: { type: 'session.updated' } });
    await hooks.event({ event: { type: 'something.else' } });
    assert.equal(spawnFn.calls.length, 0);
  });

  test('PLUGIN-09: the connection event the discriminant once named does not spawn', async () => {
    const spawnFn = fakeSpawn();
    const hooks = await hooksWith({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn,
    });

    // This name was the discriminant and OpenCode never emits it, so the check
    // never ran. Reverting to it must fail here rather than silently stop.
    await hooks.event({ event: { type: 'server.connected' } });
    assert.equal(spawnFn.calls.length, 0, 'an event opencode does not emit is not session start');
  });

  test('PLUGIN-10: a malformed event does not throw and does not spawn', async () => {
    const spawnFn = fakeSpawn();
    const hooks = await hooksWith({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn,
    });

    // This runs inside a live session, so a shape the handler did not expect
    // must never take the session down.
    await hooks.event(undefined);
    await hooks.event({});
    await hooks.event({ event: {} });
    await hooks.event({ event: null });
    assert.equal(spawnFn.calls.length, 0);
  });

  test('PLUGIN-11: the interpreter is node, not whatever loaded the plugin', async () => {
    const mod = await importPlugin(PLUGIN_PATH);
    const { resolveNodeExec } = mod;

    // OpenCode loads plugins inside its own compiled binary. Handing that
    // binary a script path makes it try to change directory to the path, so
    // the check silently never ran. The binary also reports a node version,
    // which is why the runtime cannot be identified by that key.
    assert.equal(
      resolveNodeExec({ node: '24.3.0', bun: '1.3.14' }, '/opt/opencode/bin/opencode'),
      'node',
    );
    assert.equal(resolveNodeExec({ node: '24.3.0', deno: '2.0.0' }, '/usr/bin/deno'), 'node');
    assert.equal(resolveNodeExec({ node: '24.3.0' }, '/usr/bin/node'), '/usr/bin/node');
    assert.equal(resolveNodeExec(undefined, undefined), 'node');

    const spawnFn = fakeSpawn();
    const hooks = await mod.createGsdHooks({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn,
      nodeExec: 'node',
    });
    await hooks.event({ event: { type: SESSION_START_EVENT } });
    assert.equal(spawnFn.calls[0].command, 'node');
  });

  test('PLUGIN-12: a spawn that throws does not take the session down', async () => {
    const hooks = await hooksWith({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn: () => {
        throw new Error('ENOENT: node is not on PATH');
      },
    });

    await hooks.event({ event: { type: SESSION_START_EVENT } });
  });
});

// ── V2 adapter: setup(ctx) ──────────────────────────────────────────────
// V2 replaces the V1 hook object with a setup function that registers a
// tool hook and subscribes to an event stream. These drive that contract
// with fakes; fresh adapters keep the once-guard per-test.

describe('V2 adapter: setup(ctx) wires hooks and events', () => {
  test('V2-01: setup registers a hook named exactly execute.before', async () => {
    const { ctx, release } = await v2Setup({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn: fakeSpawn(),
    });
    assert.equal(ctx.toolCalls.length, 1, 'one hook registration');
    assert.equal(ctx.toolCalls[0].name, 'execute.before');
    assert.equal(typeof ctx.toolCalls[0].cb, 'function', 'a callable hook');
    release();
  });

  test('V2-02: a denied shell command throws through the adapter with the exact reason', async () => {
    const reason = `Command "${DENY_COMMAND}" matches deny pattern "${DENY_PATTERN}"`;
    const { ctx, release } = await v2Setup({
      decide: fakeDecide({ decision: 'deny', reason }),
      loadSettings: countingSettings({ permissions: { allow: [], deny: [] } }),
      spawnFn: fakeSpawn(),
    });
    const before = ctx.toolCalls[0].cb;
    await assert.rejects(
      () =>
        before({ tool: 'shell', sessionID: 's', input: { command: DENY_COMMAND } }),
      (err) => {
        assert.equal(err.message, reason, 'the deny is not swallowed');
        return true;
      },
    );
    release();
  });

  test('V2-03: shell commands that are not denied resolve, non-shell tools never decide', async () => {
    const allow = await v2Setup({
      decide: fakeDecide({ decision: 'allow', reason: 'matched allow' }),
      loadSettings: countingSettings({}),
      spawnFn: fakeSpawn(),
    });
    const before = allow.ctx.toolCalls[0].cb;
    await before({ tool: 'shell', input: { command: 'git status' } });
    await before({ tool: 'bash', input: { command: 'curl https://example.com' } });
    allow.release();

    const decide = fakeDecide({ decision: 'deny', reason: 'should never run' });
    const loadSettings = countingSettings({});
    const ignored = await v2Setup({ decide, loadSettings, spawnFn: fakeSpawn() });
    await ignored.ctx.toolCalls[0].cb({
      tool: 'read',
      input: { filePath: '/etc/passwd' },
    });
    assert.equal(loadSettings.calls, 0, 'settings must not be read for a non-shell tool');
    assert.equal(decide.seen.length, 0, 'decide must not run for a non-shell tool');
    ignored.release();
  });

  test('V2-04: a missing or empty command resolves without consulting decide', async () => {
    const decide = fakeDecide({ decision: 'deny', reason: 'should never run' });
    const { ctx, release } = await v2Setup({
      decide,
      loadSettings: countingSettings({}),
      spawnFn: fakeSpawn(),
    });
    const before = ctx.toolCalls[0].cb;
    await before({ tool: 'shell', input: {} });
    await before({ tool: 'shell', input: { command: '' } });
    await before({ tool: 'shell' });
    assert.equal(decide.seen.length, 0, 'an absent command is nothing to decide about');
    release();
  });

  test('V2-05: repeated session-start triggers collapse to one spawn with the same shape', async () => {
    const spawnFn = fakeSpawn();
    const hooksDir = path.join(BASE_TMPDIR, 'gsd-plugin-v2-hooks-fake');
    const { release } = await v2Setup(
      {
        decide: fakeDecide({ decision: 'passthrough' }),
        loadSettings: countingSettings({}),
        spawnFn,
        hooksDir,
      },
      [
        { type: 'session.execution.started' },
        { type: 'session.execution.started' },
        { type: 'session.created' },
      ],
    );
    assert.equal(spawnFn.calls.length, 1, 'both trigger ids and repeats collapse to one');
    const call = spawnFn.calls[0];
    assert.equal(call.command, process.execPath);
    assert.deepEqual(call.args, [path.join(hooksDir, 'gsd-check-update.js')]);
    assert.ok(call.child.handlers.includes('error'));
    assert.ok(call.child.stdin.handlers.includes('error'));
    assert.deepEqual(call.options.stdio, ['pipe', 'ignore', 'ignore']);
    assert.equal(call.options.detached, true);
    assert.equal(
      call.writes.join(''),
      JSON.stringify({ source: 'startup' }),
      'the child is gated on source === startup',
    );
    assert.equal(call.child.stdinEnded, true);
    assert.equal(call.child.unrefCalled, true);
    release();
  });

  test('V2-06: cleanup aborts the recorded subscription signal', async () => {
    const { ctx, release } = await v2Setup({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn: fakeSpawn(),
    });
    assert.ok(ctx.subscribeOpts.length >= 1, 'the adapter subscribed to events');
    assert.equal(ctx.subscribeOpts[0].signal.aborted, false, 'live before cleanup');
    release();
    assert.equal(ctx.subscribeOpts[0].signal.aborted, true, 'cleanup aborts the signal');
  });
});

// ── the real factory, against a config home on disk ──────────────────────────
// The seam above proves the adapters. Only the real factory can show which
// settings file production reads, so these drive the installed layout:
// <config home>/plugin/gsd-core.js beside <config home>/gsd-ng/hooks/.

/**
 * Lay out a synthetic opencode install: the plugin at plugin/gsd-core.js, the
 * hooks payload it requires under gsd-ng/hooks/, and an isolated HOME.
 */
function stageInstall(tmpDir) {
  const configHome = path.join(tmpDir, 'cfg');
  const pluginDir = path.join(configHome, 'plugin');
  const payloadDir = path.join(configHome, 'gsd-ng', 'hooks');
  const home = path.join(tmpDir, 'home');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const installedPlugin = path.join(pluginDir, 'gsd-core.js');
  fs.copyFileSync(PLUGIN_PATH, installedPlugin);
  for (const name of ['bash-safety-hook.cjs', 'gsd-hook-stdin.cjs']) {
    fs.copyFileSync(path.join(HOOKS_DIR, name), path.join(payloadDir, name));
  }
  return { configHome, installedPlugin, home };
}

/** Run fn with HOME pointed at an empty dir and claude's env overrides cleared. */
async function withIsolatedEnv(home, fn) {
  const saved = {
    HOME: process.env.HOME,
    CLAUDE_SETTINGS_PATH: process.env.CLAUDE_SETTINGS_PATH,
    CLAUDE_PROJECT_DIR: process.env.CLAUDE_PROJECT_DIR,
  };
  process.env.HOME = home;
  delete process.env.CLAUDE_SETTINGS_PATH;
  delete process.env.CLAUDE_PROJECT_DIR;
  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

const DENY_SETTINGS = JSON.stringify({
  permissions: { allow: [], deny: [DENY_PATTERN] },
});

describe('PLUGIN: the real factory reads the config home it is installed in', () => {
  test('PLUGIN-13: a deny pattern in the config home alone blocks the command', async () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-plugin-real-a-'));
    try {
      const { configHome, installedPlugin, home } = stageInstall(tmpDir);
      fs.writeFileSync(path.join(configHome, 'settings.json'), DENY_SETTINGS);

      await withIsolatedEnv(home, async () => {
        const mod = await importPlugin(installedPlugin);
        const hooks = await mod.default.server();
        await assert.rejects(
          () =>
            hooks['tool.execute.before'](
              { tool: 'bash' },
              { args: { command: DENY_COMMAND } },
            ),
          (err) => {
            assert.match(err.message, /matches deny pattern "Bash\(rm:\*\)"/);
            return true;
          },
        );
      });
    } finally {
      cleanup(tmpDir);
    }
  });

  test('V2-07: the production V2 setup reads the config home it was installed in', async () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-plugin-v2-real-'));
    try {
      const { configHome, installedPlugin, home } = stageInstall(tmpDir);
      fs.writeFileSync(path.join(configHome, 'settings.json'), DENY_SETTINGS);

      await withIsolatedEnv(home, async () => {
        const mod = await importPlugin(installedPlugin);
        // Empty event stream: the production adapter never spawns here, so
        // only the deny path through the installed settings is exercised.
        const ctx = fakeCtx([]);
        const release = await mod.default.setup(ctx);
        const before = ctx.toolCalls[0].cb;
        await assert.rejects(
          () => before({ tool: 'shell', input: { command: DENY_COMMAND } }),
          (err) => {
            assert.match(err.message, /matches deny pattern "Bash\(rm:\*\)"/);
            return true;
          },
        );
        release();
      });
    } finally {
      cleanup(tmpDir);
    }
  });

  test('PLUGIN-14: the same deny pattern under HOME/.claude alone does not block', async () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-plugin-real-b-'));
    try {
      const { installedPlugin, home } = stageInstall(tmpDir);
      const homeClaudeDir = path.join(home, '.claude');
      fs.mkdirSync(homeClaudeDir, { recursive: true });
      fs.writeFileSync(path.join(homeClaudeDir, 'settings.json'), DENY_SETTINGS);

      await withIsolatedEnv(home, async () => {
        const mod = await importPlugin(installedPlugin);
        const hooks = await mod.default.server();
        await hooks['tool.execute.before'](
          { tool: 'bash' },
          { args: { command: DENY_COMMAND } },
        );
      });
    } finally {
      cleanup(tmpDir);
    }
  });

  test('PLUGIN-15: the factory binds a config home to the settings loader', async () => {
    const source = fs.readFileSync(PLUGIN_PATH, 'utf8');
    assert.equal(
      (source.match(/loadMergedSettings\(\)/g) || []).length,
      0,
      'a bare loadMergedSettings() falls back to the four hardcoded claude paths',
    );
    assert.match(source, /import\.meta\.url/, 'the config home derives from the module location');
    assert.match(source, /createRequire/, 'the CommonJS safety library is required, not reimplemented');
  });
});
