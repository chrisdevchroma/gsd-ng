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
const { EventEmitter } = require('events');

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
function fakeCtx(events, location) {
  const ctx = {
    toolCalls: [],
    commandTransformCalls: [],
    commandCalls: [],
    promptCalls: [],
    sessionCalls: [],
    subscribeOpts: [],
    tool: {
      async hook(name, cb) {
        ctx.toolCalls.push({ name, cb });
      },
      async list() {
        return [];
      },
    },
    command: {
      async transform(callback) {
        const added = [];
        const transformCall = { callback, added, disposed: false };
        ctx.commandTransformCalls.push(transformCall);
        callback({
          add(definition) {
            const call = {
              name: definition.name,
              definition,
              disposed: false,
            };
            added.push(call);
            ctx.commandCalls.push(call);
          },
        });
        return {
          async dispose() {
            transformCall.disposed = true;
            for (const call of added) call.disposed = true;
          },
        };
      },
    },
    session: {
      async prompt(input) {
        ctx.sessionCalls.push({ method: 'prompt', input });
        ctx.promptCalls.push(input);
        return { accepted: true };
      },
    },
    event: {
      subscribe(opts) {
        ctx.subscribeOpts.push(opts);
        return fakeAsyncIterable(events);
      },
    },
  };
  if (location) ctx.location = location;
  return ctx;
}

function plannerCtx(failAt) {
  const ctx = fakeCtx([]);
  const child = { id: 'planner-child' };
  const plannerContext = {
    sessionID: child.id,
    messages: [{ role: 'assistant', text: 'Planner completed' }],
  };
  const stage = (method, result) => async (input) => {
    ctx.sessionCalls.push({ method, input });
    if (failAt === method) throw new Error(`${method} failed`);
    return result;
  };
  ctx.session.create = stage('create', child);
  ctx.session.switchAgent = stage('switchAgent', { selected: true });
  ctx.session.prompt = stage('prompt', { accepted: true });
  ctx.session.wait = stage('wait', { status: 'completed' });
  ctx.session.context = stage('context', plannerContext);
  ctx.session.synthetic = stage('synthetic', { published: true });
  ctx.plannerContext = plannerContext;
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
  const setup = mod.createV2Adapter({
    commandManifest: { schema_version: 1, commands: [] },
    ...overrides,
  });
  const ctx = fakeCtx(events || []);
  const release = await setup(ctx);
  await new Promise((r) => setTimeout(r, 50));
  return { ctx, release };
}

const COMMAND_INPUT_CORPUS = [
  '',
  'two words',
  "single ' quote",
  'double " quote',
  'line one\nline two',
  '$(touch should-not-run)',
  '`touch should-not-run`',
  'first; second',
  '--unknown value',
  '$ARGUMENTS',
  '$&',
  '$$',
  "$'",
  '$`',
  '!`printf OPEN_CODE_ARGUMENT_EXECUTION`',
  'before !`printf FIRST_MARKER` between !`printf SECOND_MARKER` after',
];

function commandRecord(overrides = {}) {
  return {
    name: 'gsd-sample',
    description: 'Sample command',
    template: '<arguments>\n$ARGUMENTS\n</arguments>',
    argument_mode: 'replace',
    route: { kind: 'current' },
    preludes: [],
    ...overrides,
  };
}

function commandManifest(commands) {
  return { schema_version: 1, commands };
}

function fakeCompletingSpawn(outputs) {
  const calls = [];
  const queue = outputs.slice();
  const fn = (command, args, options) => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    calls.push({ command, args, options, child });
    const next = queue.shift() || { stdout: '', stderr: '', code: 0 };
    queueMicrotask(() => {
      if (next.error) {
        child.emit('error', next.error);
        return;
      }
      if (next.stdout) child.stdout.emit('data', Buffer.from(next.stdout));
      if (next.stderr) child.stderr.emit('data', Buffer.from(next.stderr));
      child.emit('close', next.code ?? 0);
    });
    return child;
  };
  fn.calls = calls;
  return fn;
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

  test('V2-08: a second setup on the same adapter retires the first subscription', async () => {
    const mod = await importPlugin(PLUGIN_PATH);
    const setup = mod.createV2Adapter({
      decide: fakeDecide({ decision: 'passthrough' }),
      loadSettings: countingSettings({}),
      spawnFn: fakeSpawn(),
      commandManifest: commandManifest([]),
    });
    const ctx1 = fakeCtx([]);
    const release1 = await setup(ctx1);
    const ctx2 = fakeCtx([]);
    const release2 = await setup(ctx2);
    assert.equal(
      ctx1.subscribeOpts[0].signal.aborted,
      true,
      'the previous subscription is retired when setup runs again',
    );
    assert.equal(ctx2.subscribeOpts[0].signal.aborted, false, 'the new one is live');
    release2();
    release1();
  });

  test('V2-09: a stream error that is not an abort is logged, not swallowed', async () => {
    const errors = [];
    const savedError = console.error;
    console.error = (...args) => errors.push(args.map(String).join(' '));
    try {
      const mod = await importPlugin(PLUGIN_PATH);
      const setup = mod.createV2Adapter({
        decide: fakeDecide({ decision: 'passthrough' }),
        loadSettings: countingSettings({}),
        spawnFn: fakeSpawn(),
        commandManifest: commandManifest([]),
      });
      const ctx = {
        tool: {
          async hook() {
            return undefined;
          },
        },
        command: {
          async transform(callback) {
            callback({ add() {} });
            return undefined;
          },
        },
        event: {
          subscribe() {
            return {
              async *[Symbol.asyncIterator]() {
                throw new Error('stream exploded');
              },
            };
          },
        },
      };
      const release = await setup(ctx);
      await new Promise((r) => setTimeout(r, 50));
      release();
      assert.ok(
        errors.some((e) => e.includes('stream exploded')),
        'the failure is surfaced instead of silently ending the update check',
      );
    } finally {
      console.error = savedError;
    }
  });
});

describe('PLUGIN command manifest: safe current-session callbacks', () => {
  test('PLUGIN command argument transport preserves every input byte and never spawns from hostile markers', async () => {
    const spawnFn = fakeCompletingSpawn([]);
    const { ctx, release } = await v2Setup({
      spawnFn,
      commandManifest: commandManifest([commandRecord()]),
    });
    assert.equal(ctx.commandCalls.length, 1);
    assert.equal(ctx.commandCalls[0].name, 'gsd-sample');
    assert.equal(ctx.commandCalls[0].definition.description, 'Sample command');

    for (const text of COMMAND_INPUT_CORPUS) {
      const files = [{ path: 'one.md' }];
      const agents = [{ name: 'helper' }];
      const skills = [{ name: 'skill' }];
      const delivery = { mode: 'immediate' };
      await ctx.commandCalls[0].definition.execute({
        sessionID: 'parent-session',
        prompt: { text, files, agents, skills },
        delivery,
      });
      const submitted = ctx.promptCalls.at(-1);
      assert.equal(submitted.sessionID, 'parent-session');
      assert.equal(submitted.text, `<arguments>\n${text}\n</arguments>`);
      assert.strictEqual(submitted.files, files);
      assert.strictEqual(submitted.agents, agents);
      assert.strictEqual(submitted.skills, skills);
      assert.strictEqual(submitted.delivery, delivery);
    }
    assert.deepStrictEqual(spawnFn.calls, []);
    await release();
  });

  test('PLUGIN command argument transport appends unexpected input without scanning hostile markers', async () => {
    const spawnFn = fakeCompletingSpawn([]);
    const { ctx, release } = await v2Setup({
      spawnFn,
      commandManifest: commandManifest([
        commandRecord({
          name: 'gsd-no-arguments',
          template: 'Static prompt',
          argument_mode: 'append',
        }),
      ]),
    });
    const hostile = ' !`printf FIRST`\n!`printf SECOND` ';
    await ctx.commandCalls[0].definition.execute({
      sessionID: 'session',
      prompt: { text: hostile, files: [], agents: [], skills: [] },
      delivery: 'queued',
    });
    assert.equal(ctx.promptCalls[0].text, `Static prompt\n\n${hostile}`);
    assert.deepStrictEqual(spawnFn.calls, []);
    await release();
  });

  test('PLUGIN command prelude runs only allowlisted argv with shell false before hostile input insertion', async () => {
    const spawnFn = fakeCompletingSpawn([
      { stdout: 'PREVIEW OUTPUT\n', code: 0 },
      { stdout: 'FINAL OUTPUT\n', code: 0 },
    ]);
    const toolsPath = path.join('/isolated', 'gsd-tools.cjs');
    const tokens = [
      '<gsd-prelude-output index="0">',
      '<gsd-prelude-output index="1">',
    ];
    const { ctx, release } = await v2Setup({
      spawnFn,
      nodeExec: '/usr/bin/node',
      toolsPath,
      commandManifest: commandManifest([
        commandRecord({
          name: 'gsd-cleanup',
          template: `${tokens[0]}\n${tokens[1]}\n$ARGUMENTS`,
          preludes: [
            {
              token: tokens[0],
              operation: 'gsd-tools',
              argv: ['cleanup', '--dry-run'],
            },
            {
              token: tokens[1],
              operation: 'gsd-tools',
              argv: ['cleanup'],
            },
          ],
        }),
      ]),
    });
    const hostile = '!`printf OPEN_CODE_ARGUMENT_EXECUTION`';
    await ctx.commandCalls[0].definition.execute({
      sessionID: 'session',
      prompt: { text: hostile, files: [], agents: [], skills: [] },
      delivery: 'immediate',
    });
    assert.deepStrictEqual(
      spawnFn.calls.map(({ command, args, options }) => ({
        command,
        args,
        options,
      })),
      [
        {
          command: '/usr/bin/node',
          args: [toolsPath, 'cleanup', '--dry-run'],
          options: { stdio: ['ignore', 'pipe', 'pipe'], shell: false },
        },
        {
          command: '/usr/bin/node',
          args: [toolsPath, 'cleanup'],
          options: { stdio: ['ignore', 'pipe', 'pipe'], shell: false },
        },
      ],
    );
    assert.equal(
      ctx.promptCalls[0].text,
      `PREVIEW OUTPUT\nFINAL OUTPUT\n${hostile}`,
    );
    await release();
  });

  test('PLUGIN command manifest rejects malformed sets without partial registration', async () => {
    const badManifests = [
      { schema_version: 2, commands: [] },
      commandManifest([
        commandRecord(),
        commandRecord({ description: 'Duplicate' }),
      ]),
      commandManifest([
        commandRecord({ route: { kind: 'unknown' } }),
      ]),
      commandManifest([
        commandRecord({
          template: '$ARGUMENTS $ARGUMENTS',
        }),
      ]),
      commandManifest([
        commandRecord({
          template: '<gsd-prelude-output index="0">\n$ARGUMENTS',
          preludes: [
            {
              token: '<gsd-prelude-output index="1">',
              operation: 'gsd-tools',
              argv: ['cleanup'],
            },
          ],
        }),
      ]),
      commandManifest([
        commandRecord({
          template: '<gsd-prelude-output index="0">\n$ARGUMENTS',
          preludes: [
            {
              token: '<gsd-prelude-output index="0">',
              operation: 'gsd-tools',
              argv: ['cleanup', '--force'],
            },
          ],
        }),
      ]),
    ];
    const mod = await importPlugin(PLUGIN_PATH);
    for (const manifest of badManifests) {
      const ctx = fakeCtx([]);
      const setup = mod.createV2Adapter({
        commandManifest: manifest,
        spawnFn: fakeCompletingSpawn([]),
      });
      await assert.rejects(() => setup(ctx), /command manifest|command record|prelude/i);
      assert.equal(ctx.commandCalls.length, 0);
      assert.equal(ctx.promptCalls.length, 0);
    }
  });

  test('PLUGIN command prelude failures reject without submitting a prompt', async () => {
    const token = '<gsd-prelude-output index="0">';
    const spawnFn = fakeCompletingSpawn([
      { stderr: 'cleanup failed', code: 7 },
    ]);
    const { ctx, release } = await v2Setup({
      spawnFn,
      toolsPath: '/isolated/gsd-tools.cjs',
      commandManifest: commandManifest([
        commandRecord({
          template: `${token}\n$ARGUMENTS`,
          preludes: [
            { token, operation: 'gsd-tools', argv: ['cleanup'] },
          ],
        }),
      ]),
    });
    await assert.rejects(
      () =>
        ctx.commandCalls[0].definition.execute({
          sessionID: 'session',
          prompt: { text: 'safe', files: [], agents: [], skills: [] },
          delivery: 'immediate',
        }),
      /cleanup failed|code 7/i,
    );
    assert.equal(ctx.promptCalls.length, 0);
    await release();
  });

  test('PLUGIN command registrations are disposed on reload cleanup', async () => {
    const mod = await importPlugin(PLUGIN_PATH);
    const setup = mod.createV2Adapter({
      commandManifest: commandManifest([commandRecord()]),
      spawnFn: fakeCompletingSpawn([]),
    });
    const first = fakeCtx([]);
    await setup(first);
    assert.equal(first.commandCalls[0].disposed, false);
    const second = fakeCtx([]);
    const release = await setup(second);
    assert.equal(first.commandCalls[0].disposed, true);
    await release();
    assert.equal(second.commandCalls[0].disposed, true);
  });
});

describe('PLUGIN planner command: child-session routing', () => {
  const plannerRecord = () =>
    commandRecord({
      name: 'gsd-plan-phase',
      description: 'Plan a phase',
      route: { kind: 'planner', agent: 'gsd-planner' },
    });

  test('PLUGIN planner creates and selects a child, waits, then publishes to the parent', async () => {
    const mod = await importPlugin(PLUGIN_PATH);
    const setup = mod.createV2Adapter({
      commandManifest: commandManifest([plannerRecord()]),
      spawnFn: fakeCompletingSpawn([]),
    });
    const ctx = plannerCtx();
    const release = await setup(ctx);
    assert.equal(ctx.commandCalls.length, 1);
    const files = [{ path: 'phase.md' }];
    const agents = [{ name: 'mentioned-agent' }];
    const skills = [{ name: 'planning-skill' }];
    const delivery = { mode: 'background' };
    await ctx.commandCalls[0].definition.execute({
      sessionID: 'parent-session',
      prompt: { text: '12 --gaps', files, agents, skills },
      delivery,
    });

    assert.deepStrictEqual(
      ctx.sessionCalls.map((call) => call.method),
      ['create', 'switchAgent', 'prompt', 'wait', 'context', 'synthetic'],
    );
    assert.deepStrictEqual(ctx.sessionCalls[0].input, {});
    assert.deepStrictEqual(ctx.sessionCalls[1].input, {
      sessionID: 'planner-child',
      agent: 'gsd-planner',
    });
    const childPrompt = ctx.sessionCalls[2].input;
    assert.equal(childPrompt.sessionID, 'planner-child');
    assert.equal(childPrompt.text, '<arguments>\n12 --gaps\n</arguments>');
    assert.strictEqual(childPrompt.files, files);
    assert.strictEqual(childPrompt.agents, agents);
    assert.strictEqual(childPrompt.skills, skills);
    assert.strictEqual(childPrompt.delivery, delivery);
    assert.deepStrictEqual(ctx.sessionCalls[3].input, {
      sessionID: 'planner-child',
    });
    assert.deepStrictEqual(ctx.sessionCalls[4].input, {
      sessionID: 'planner-child',
    });
    assert.deepStrictEqual(ctx.sessionCalls[5].input, {
      sessionID: 'parent-session',
      text: JSON.stringify(ctx.plannerContext),
    });
    assert.ok(
      !ctx.sessionCalls.some(
        (call) =>
          call.method === 'prompt' && call.input.sessionID === 'parent-session',
      ),
    );
    await release();
  });

  test('PLUGIN planner failures at every public API stage reject and never prompt the parent', async () => {
    const mod = await importPlugin(PLUGIN_PATH);
    for (const failAt of [
      'create',
      'switchAgent',
      'prompt',
      'wait',
      'context',
    ]) {
      const setup = mod.createV2Adapter({
        commandManifest: commandManifest([plannerRecord()]),
        spawnFn: fakeCompletingSpawn([]),
      });
      const ctx = plannerCtx(failAt);
      const release = await setup(ctx);
      await assert.rejects(
        () =>
          ctx.commandCalls[0].definition.execute({
            sessionID: 'parent-session',
            prompt: {
              text: '12',
              files: [],
              agents: [],
              skills: [],
            },
            delivery: 'background',
          }),
        new RegExp(`${failAt} failed`),
      );
      assert.ok(
        !ctx.sessionCalls.some(
          (call) =>
            call.method === 'prompt' &&
            call.input.sessionID === 'parent-session',
        ),
      );
      assert.ok(
        ctx.sessionCalls.some(
          (call) =>
            call.method === 'synthetic' &&
            call.input.sessionID === 'parent-session' &&
            call.input.text.includes(`${failAt} failed`),
        ),
      );
      await release();
    }
  });
});

// ── the real factory, against a config home on disk ──────────────────────────
// The seam above proves the adapters. Only the real factory can show which
// settings file production reads, so these drive the installed layout:
// <config home>/plugins/gsd-core.js beside <config home>/gsd-ng/hooks/.

/**
 * Lay out a synthetic opencode install: the plugin at plugins/gsd-core.js, the
 * hooks payload it requires under gsd-ng/hooks/, and an isolated HOME.
 */
function stageInstall(tmpDir) {
  const configHome = path.join(tmpDir, 'cfg');
  const pluginDir = path.join(configHome, 'plugins');
  const payloadDir = path.join(configHome, 'gsd-ng', 'hooks');
  const home = path.join(tmpDir, 'home');
  fs.mkdirSync(pluginDir, { recursive: true });
  fs.mkdirSync(payloadDir, { recursive: true });
  fs.mkdirSync(home, { recursive: true });

  const installedPlugin = path.join(pluginDir, 'gsd-core.js');
  fs.copyFileSync(PLUGIN_PATH, installedPlugin);
  fs.writeFileSync(
    path.join(configHome, 'gsd-ng', 'opencode-commands.json'),
    JSON.stringify(commandManifest([])),
  );
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
    GSD_PROJECT_DIR: process.env.GSD_PROJECT_DIR,
  };
  process.env.HOME = home;
  delete process.env.CLAUDE_SETTINGS_PATH;
  delete process.env.CLAUDE_PROJECT_DIR;
  delete process.env.GSD_PROJECT_DIR;
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

  test('the V2 plugin uses the project root instead of a nested active location or leaked env', async () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-plugin-v2-root-'));
    try {
      const { installedPlugin, home } = stageInstall(tmpDir);
      const projectRoot = path.join(tmpDir, 'repo');
      const activeLocation = path.join(projectRoot, 'packages', 'app');
      const claudeProject = path.join(tmpDir, 'claude');
      const gsdProject = path.join(tmpDir, 'gsd');
      for (const projectDir of [
        projectRoot,
        activeLocation,
        claudeProject,
        gsdProject,
      ]) {
        fs.mkdirSync(path.join(projectDir, '.opencode'), { recursive: true });
      }
      fs.writeFileSync(
        path.join(projectRoot, '.opencode', 'settings.json'),
        DENY_SETTINGS,
      );

      await withIsolatedEnv(home, async () => {
        process.env.CLAUDE_PROJECT_DIR = claudeProject;
        process.env.GSD_PROJECT_DIR = gsdProject;
        const mod = await importPlugin(installedPlugin);
        const ctx = fakeCtx([], {
          directory: activeLocation,
          project: {
            id: 'project',
            directory: projectRoot,
            canonical: path.join(tmpDir, 'canonical'),
          },
        });
        const release = await mod.default.setup(ctx);
        await assert.rejects(
          () =>
            ctx.toolCalls[0].cb({
              tool: 'shell',
              input: { command: DENY_COMMAND },
            }),
          /matches deny pattern "Bash\(rm:\*\)"/,
        );
        release();
      });
    } finally {
      cleanup(tmpDir);
    }
  });

  test('the V2 plugin falls back to GSD_PROJECT_DIR when project metadata is unavailable', async () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-plugin-v2-fallback-'));
    try {
      const { installedPlugin, home } = stageInstall(tmpDir);
      const activeLocation = path.join(tmpDir, 'repo', 'packages', 'app');
      const claudeProject = path.join(tmpDir, 'claude');
      const gsdProject = path.join(tmpDir, 'gsd');
      for (const projectDir of [activeLocation, claudeProject, gsdProject]) {
        fs.mkdirSync(path.join(projectDir, '.opencode'), { recursive: true });
      }
      fs.writeFileSync(
        path.join(gsdProject, '.opencode', 'settings.json'),
        DENY_SETTINGS,
      );

      await withIsolatedEnv(home, async () => {
        process.env.CLAUDE_PROJECT_DIR = claudeProject;
        process.env.GSD_PROJECT_DIR = gsdProject;
        const mod = await importPlugin(installedPlugin);
        const ctx = fakeCtx([], { directory: activeLocation });
        const release = await mod.default.setup(ctx);
        await assert.rejects(
          () =>
            ctx.toolCalls[0].cb({
              tool: 'shell',
              input: { command: DENY_COMMAND },
            }),
          /matches deny pattern "Bash\(rm:\*\)"/,
        );
        release();
      });
    } finally {
      cleanup(tmpDir);
    }
  });

  test('the V1 plugin uses project.worktree instead of a nested active directory or leaked env', async () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-plugin-v1-project-'));
    try {
      const { installedPlugin, home } = stageInstall(tmpDir);
      const projectRoot = path.join(tmpDir, 'repo');
      const activeLocation = path.join(projectRoot, 'packages', 'app');
      const claudeProject = path.join(tmpDir, 'claude');
      const gsdProject = path.join(tmpDir, 'gsd');
      for (const projectDir of [
        projectRoot,
        activeLocation,
        claudeProject,
        gsdProject,
      ]) {
        fs.mkdirSync(path.join(projectDir, '.opencode'), { recursive: true });
      }
      fs.writeFileSync(
        path.join(projectRoot, '.opencode', 'settings.json'),
        DENY_SETTINGS,
      );

      await withIsolatedEnv(home, async () => {
        process.env.CLAUDE_PROJECT_DIR = claudeProject;
        process.env.GSD_PROJECT_DIR = gsdProject;
        const mod = await importPlugin(installedPlugin);
        const hooks = await mod.default.server({
          directory: activeLocation,
          project: { id: 'project', worktree: projectRoot },
        });
        await assert.rejects(
          () =>
            hooks['tool.execute.before'](
              { tool: 'bash' },
              { args: { command: DENY_COMMAND } },
            ),
          /matches deny pattern "Bash\(rm:\*\)"/,
        );
      });
    } finally {
      cleanup(tmpDir);
    }
  });

  test('the V1 plugin falls back to GSD_PROJECT_DIR when project metadata is unavailable', async () => {
    const tmpDir = fs.mkdtempSync(path.join(BASE_TMPDIR, 'gsd-plugin-v1-root-'));
    try {
      const { installedPlugin, home } = stageInstall(tmpDir);
      const claudeProject = path.join(tmpDir, 'claude');
      const gsdProject = path.join(tmpDir, 'gsd');
      fs.mkdirSync(path.join(claudeProject, '.opencode'), { recursive: true });
      fs.mkdirSync(path.join(gsdProject, '.opencode'), { recursive: true });
      fs.writeFileSync(
        path.join(gsdProject, '.opencode', 'settings.json'),
        DENY_SETTINGS,
      );

      await withIsolatedEnv(home, async () => {
        process.env.CLAUDE_PROJECT_DIR = claudeProject;
        process.env.GSD_PROJECT_DIR = gsdProject;
        const mod = await importPlugin(installedPlugin);
        const hooks = await mod.default.server({
          directory: claudeProject,
          project: {},
        });
        await assert.rejects(
          () =>
            hooks['tool.execute.before'](
              { tool: 'bash' },
              { args: { command: DENY_COMMAND } },
            ),
          /matches deny pattern "Bash\(rm:\*\)"/,
        );
      });
    } finally {
      cleanup(tmpDir);
    }
  });
});
